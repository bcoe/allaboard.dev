"use client";

/**
 * The AI-generated banner at the top of a session permalink.
 *
 * Lifecycle, from the client's point of view:
 *
 *   - `ready`   → show the image (fades in once decoded).
 *   - `pending` → a generation is in flight elsewhere; poll until it settles.
 *                 A signed-in viewer also POSTs, which is what recovers a
 *                 session left `pending` by the scheme that wrote that row
 *                 before generating: the server no longer writes one, so a
 *                 `pending` read from the database describes a request that
 *                 died rather than one that is running.
 *   - `none`    → if the viewer is signed in, ask the server to generate one —
 *                 their own session or anyone else's. A session earns its
 *                 banner on whichever visit gets there first. Signed-out
 *                 visitors render nothing: generation costs real inference and
 *                 wants an account behind it.
 *   - `failed`  → retry automatically while the server says `canRetry`. Image
 *                 generation fails transiently, and the fix for that is
 *                 another attempt on the next visit rather than a session
 *                 that is permanently blank. Once the budget is spent, the
 *                 owner gets a quiet "try again" — only they can reset it,
 *                 so only they are offered it; everyone else sees nothing.
 *
 * A *successful* banner is never regenerated on its own, so the placeholder is
 * shown at most once per session in the happy path. Signed-in viewers get a
 * quiet corner button to ask for a different picture; that is the only path
 * that replaces an image the session already has.
 *
 * If polling runs out with still no image, the placeholder keeps the same
 * corner button — a session that looks wedged is one press from another
 * attempt, rather than something to wait out.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getSessionImage, generateSessionImage, regenerateSessionImage } from "@/lib/db";
import type { SessionImage } from "@/lib/types";

/** Poll interval while a generation started elsewhere is in flight. */
const POLL_MS = 4000;
/** Stop polling eventually so a wedged job doesn't spin a tab forever. */
const MAX_POLLS = 30;

export default function SessionHeaderImage({
  sessionId,
  isOwner,
  isLoggedIn = false,
}: {
  sessionId: string;
  /** Viewer is the climber whose session this is — gates the manual retry. */
  isOwner: boolean;
  /** Viewer is signed in at all — gates triggering generation. */
  isLoggedIn?: boolean;
}) {
  // An owner is by definition signed in; spelling it out keeps the two props
  // independent for callers that only know one of them.
  const canGenerate = isOwner || isLoggedIn;

  const [image, setImage] = useState<SessionImage | null>(null);
  /**
   * The url whose bytes have decoded.
   *
   * Not a bare `loaded` boolean: the loading state has to be a property of the
   * *current* picture, not a free-floating flag. When a settle left the url
   * unchanged, resetting a boolean put the placeholder back up over an image
   * that had already loaded — and since the <img> never remounted, `load` never
   * fired again and nothing ever took it down.
   */
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  /** A press of the corner button is in progress, job and all. */
  const [working, setWorking] = useState(false);
  /** Waiting gave up with no image — the banner looks wedged. */
  const [stalled, setStalled] = useState(false);
  // Asking is a side effect with a cost; StrictMode double-mounts in dev would
  // otherwise fire it twice (the server dedupes too, but not paying for the
  // round trip is better).
  const requested = useRef(false);
  // Set on unmount so nothing below writes state into a dead component.
  //
  // Reset on *mount* as well, and declared before the effect that reads it so it
  // runs first. React's development double-invoke mounts, unmounts and mounts
  // again, and refs survive that — a flag that only ever flipped to true would
  // leave the second mount permanently cancelled, so the banner rendered nothing
  // at all under `next dev` while working fine in production.
  const gone = useRef(false);
  useEffect(() => {
    gone.current = false;
    return () => { gone.current = true };
  }, []);

  /**
   * Waits for a queued job to produce something.
   *
   * `none` counts as "still working": no row is written until the job finishes,
   * so an absent row during this window means the job is running, not missing.
   *
   * `replacing` is the url of the banner this job is about to overwrite, and it
   * matters for the same reason. Regenerating is the one case where a good row
   * already exists while a job runs — the status stays `ready`, pointing at the
   * old picture, for the whole ~35s. Without a baseline to compare against, the
   * first poll would accept that stale row and stop waiting 4s after the press.
   *
   * Returns the settled state, or null if the wait ran out.
   */
  const awaitJob = useCallback(
    async (replacing?: string): Promise<SessionImage | null> => {
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (gone.current) return null;

        const next = await getSessionImage(sessionId).catch(() => null);
        if (!next) continue;

        // Still working: no row yet, or one left behind by a dead request.
        if (next.status === "none" || next.status === "pending") continue;
        // The picture being replaced, not the replacement. The url carries the
        // row's updated_at, so an unchanged url means unchanged bytes.
        if (next.status === "ready" && replacing && next.url === replacing) continue;

        return next;
      }
      return null;
    },
    [sessionId],
  );

  /**
   * Applies whatever a job produced, or marks the banner wedged.
   *
   * Nothing to do about the loading state here — it is derived from whether the
   * url on screen has decoded, so a new url shows the placeholder and fades in
   * on its own, and an unchanged one is left alone.
   */
  const applySettled = useCallback((settled: SessionImage | null) => {
    if (gone.current) return;
    if (settled) setImage(settled);
    else setStalled(true);
  }, []);

  /**
   * Resolves what a request produced: the outcome itself if the server had
   * nothing to queue, otherwise whatever the job eventually writes.
   *
   * `null` means the request never landed, so there is no job to wait for —
   * polling two minutes for one that was never queued would leave the button
   * disabled for no reason.
   */
  const settle = useCallback(
    async (queued: SessionImage | null, replacing?: string): Promise<SessionImage | null> => {
      if (!queued) return null;
      return queued.status === "pending" ? awaitJob(replacing) : queued;
    },
    [awaitJob],
  );

  useEffect(() => {
    if (!sessionId) return;

    void (async () => {
      const first = await getSessionImage(sessionId).catch(() => null);
      if (!first || gone.current) return;
      setImage(first);

      // A fresh session; one reading `pending` from a job that died before
      // writing an image; or a failed one the server will still retry.
      const shouldRequest =
        first.status === "none" ||
        first.status === "pending" ||
        (first.status === "failed" && first.canRetry);

      if (!shouldRequest || !canGenerate || requested.current) {
        // Not ours to start. Wait anyway when a job is in flight — someone
        // else's, or one an earlier mount of this component already asked for.
        // Without that second case a remount sits on a stale `none` forever
        // while the job it started finishes behind it.
        if (first.status === "pending" || (requested.current && canGenerate)) {
          applySettled(await awaitJob());
        }
        return;
      }

      requested.current = true;
      const queued = await generateSessionImage(sessionId).catch(() => null);
      if (gone.current) return;

      // Show the queued state first, so the placeholder covers the wait rather
      // than the page sitting on a stale `none`.
      if (queued?.status === "pending") setImage(queued);
      applySettled(await settle(queued));
    })();
  }, [sessionId, canGenerate, awaitJob, applySettled, settle]);

  // The banner currently on screen, if any — the baseline a replacement job is
  // measured against.
  const currentUrl = image?.status === "ready" ? image.url : undefined;

  /** Explicit retry after the automatic budget ran out — resets it server-side. */
  const retry = useCallback(async () => {
    setWorking(true);
    setStalled(false);
    const queued = await generateSessionImage(sessionId, true).catch(() => null);
    applySettled(await settle(queued, currentUrl));
    if (!gone.current) setWorking(false);
  }, [sessionId, settle, applySettled, currentUrl]);

  /**
   * Ask for a different picture, or for another go at one that never arrived.
   *
   * The current banner stays on screen for the whole job: it is still the
   * session's banner until a replacement actually arrives, and if the render
   * fails it still is. `working` holds through the job rather than just the
   * enqueue, so the button cannot be pressed into queuing five images.
   */
  const regenerate = useCallback(async () => {
    setWorking(true);
    setStalled(false);
    const queued = await regenerateSessionImage(sessionId).catch(() => null);
    applySettled(await settle(queued, currentUrl));
    if (!gone.current) setWorking(false);
  }, [sessionId, settle, applySettled, currentUrl]);

  if (!image) return null;

  // Out of automatic retries. The owner gets a way back — they're the only one
  // the server lets reset the budget; everyone else gets the page exactly as it
  // was before, with no broken-looking gap.
  if (image.status === "failed" && !image.canRetry && !working) {
    return isOwner ? <BannerFailed onRetry={retry} /> : null;
  }

  // Nothing to show and no one here to make it: render nothing rather than an
  // empty 400px frame waiting on a generation that isn't coming. A signed-out
  // viewer gets the same treatment once a banner has visibly given up — the
  // press that would fix it is not one they can make.
  const awaitingGeneration =
    image.status === "none" ||
    (image.status === "failed" && image.canRetry) ||
    (image.status === "pending" && stalled);
  if (awaitingGeneration && !canGenerate) return null;

  const showImage = image.status === "ready" && image.url;
  // The placeholder covers the banner until *this* picture has decoded, so a
  // replacement fades in on its own and an unchanged one is never re-covered.
  const loaded = !!showImage && loadedUrl === image.url;
  // Offered over a finished banner (a different picture) and over one that
  // never arrived (another attempt) — the same press either way.
  const canPress = canGenerate && (showImage || stalled);

  return (
    <div className="relative mt-4 w-full aspect-[3/1] overflow-hidden rounded-xl border border-stone-700 bg-stone-900">
      {showImage && (
        // Not next/image: the bytes come from our own API route, which is
        // already immutable-cached, and the optimizer adds nothing here.
        // The key is the versioned url, so a regenerated banner remounts and
        // fires `load` again instead of silently reusing the old element.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={image.url}
          src={image.url}
          alt=""
          onLoad={() => setLoadedUrl(image.url ?? null)}
          className={`h-full w-full object-cover transition-opacity duration-700 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}

      {!loaded && <BannerPlaceholder stalled={stalled && !working} />}

      {canPress && (
        <RegenerateButton
          onClick={regenerate}
          busy={working}
          label={showImage ? "Generate a new image" : "Try generating this image again"}
        />
      )}
    </div>
  );
}

/**
 * Ask for a(nother) picture of this session.
 *
 * Sits in the corner of the banner and stays quiet — it spends real inference
 * and may overwrite something the climber is happy with, so it reads as an
 * afterthought rather than a call to action. Only shown to signed-in viewers,
 * who are the only ones the server will accept it from.
 *
 * The same control does both jobs: over a finished banner it asks for a
 * different picture, and over one that never arrived it asks again. The wording
 * changes; the press does not.
 */
function RegenerateButton({
  onClick,
  busy,
  label,
}: {
  onClick: () => void;
  busy: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={busy ? "Picturing this session again…" : label}
      aria-label={label}
      className="absolute bottom-2 right-2 rounded-lg border border-stone-700/70 bg-stone-950/60 p-1.5 text-stone-400 backdrop-blur-sm transition-colors hover:border-stone-600 hover:text-orange-400 disabled:cursor-not-allowed disabled:text-stone-500 disabled:hover:border-stone-700/70 disabled:hover:text-stone-500"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`}
      >
        <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
        <path d="M13.5 2v3h-3" />
      </svg>
    </button>
  );
}

/**
 * The loading state: a dim stone field with a slow warm sweep, sized exactly
 * like the finished banner so the page doesn't shift when it arrives.
 *
 * Once `stalled`, the sweep stops and the wording changes. An animation that
 * keeps running after the work has plainly stopped is a lie the corner button
 * has to argue with.
 */
function BannerPlaceholder({ stalled = false }: { stalled?: boolean }) {
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-stone-900 via-stone-800 to-stone-900 overflow-hidden">
      {!stalled && (
        <div className="absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-orange-500/10 to-transparent animate-banner-sweep" />
      )}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-stone-600 text-xs tracking-wide">
          {stalled ? "No image yet." : "Picturing your session…"}
        </span>
      </div>
    </div>
  );
}

/**
 * Shown to the owner once automatic retries are exhausted.
 *
 * Deliberately a thin line rather than a full-height banner-shaped box: the
 * session has no image, and reserving 400px of empty frame for that fact would
 * be worse than the missing picture.
 */
function BannerFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-stone-800 bg-stone-900/60 px-4 py-2.5">
      <span className="text-stone-500 text-xs">Couldn&apos;t picture this session.</span>
      <button
        onClick={onRetry}
        className="shrink-0 text-xs text-stone-400 hover:text-orange-400 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
