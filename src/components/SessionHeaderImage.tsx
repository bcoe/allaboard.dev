"use client";

/**
 * The AI-generated banner at the top of a session permalink.
 *
 * Lifecycle, from the client's point of view:
 *
 *   - `ready`   → show the image (fades in once decoded).
 *   - `pending` → another tab or request is generating; poll until it settles.
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
 * A *successful* banner is never regenerated, so the placeholder is shown at
 * most once per session in the happy path.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getSessionImage, generateSessionImage } from "@/lib/db";
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
  const [loaded, setLoaded] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // Generation is a side effect with a cost; StrictMode double-mounts in dev
  // would otherwise fire it twice (the server dedupes too, but not paying for
  // the round trip is better).
  const requested = useRef(false);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;

    async function settle(state: SessionImage) {
      if (cancelled) return;
      setImage(state);

      // A fresh session, or a failed one the server is still willing to retry.
      const shouldGenerate =
        state.status === "none" || (state.status === "failed" && state.canRetry);

      if (shouldGenerate && canGenerate && !requested.current) {
        requested.current = true;
        // Held open for the whole pipeline (~30s); the placeholder covers it.
        const done = await generateSessionImage(sessionId).catch(
          () => ({ sessionId, status: "failed", canRetry: false }) as SessionImage,
        );
        if (!cancelled) setImage(done);
        return;
      }

      if (state.status === "pending" && polls < MAX_POLLS) {
        polls += 1;
        timer = setTimeout(() => {
          void getSessionImage(sessionId).then(settle).catch(() => {});
        }, POLL_MS);
      }
    }

    void getSessionImage(sessionId).then(settle).catch(() => {});

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, canGenerate]);

  /** Explicit retry after the automatic budget ran out — resets it server-side. */
  const retry = useCallback(async () => {
    setRetrying(true);
    const done = await generateSessionImage(sessionId, true).catch(
      () => ({ sessionId, status: "failed", canRetry: false }) as SessionImage,
    );
    setImage(done);
    setRetrying(false);
  }, [sessionId]);

  if (!image) return null;

  // Out of automatic retries. The owner gets a way back — they're the only one
  // the server lets reset the budget; everyone else gets the page exactly as it
  // was before, with no broken-looking gap.
  if (image.status === "failed" && !image.canRetry && !retrying) {
    return isOwner ? <BannerFailed onRetry={retry} /> : null;
  }

  // Nothing to show and no one here to make it: render nothing rather than an
  // empty 400px frame waiting on a generation that isn't coming. (A `pending`
  // session still shows the placeholder — someone else's image is on its way.)
  const awaitingGeneration =
    image.status === "none" || (image.status === "failed" && image.canRetry);
  if (awaitingGeneration && !canGenerate) return null;

  const showImage = image.status === "ready" && image.url;

  return (
    <div className="relative mt-4 w-full aspect-[3/1] overflow-hidden rounded-xl border border-stone-700 bg-stone-900">
      {showImage && (
        // Not next/image: the bytes come from our own API route, which is
        // already immutable-cached, and the optimizer adds nothing here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image.url}
          alt=""
          onLoad={() => setLoaded(true)}
          className={`h-full w-full object-cover transition-opacity duration-700 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}

      {!loaded && <BannerPlaceholder />}
    </div>
  );
}

/**
 * The loading state: a dim stone field with a slow warm sweep, sized exactly
 * like the finished banner so the page doesn't shift when it arrives.
 */
function BannerPlaceholder() {
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-stone-900 via-stone-800 to-stone-900 overflow-hidden">
      <div className="absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-orange-500/10 to-transparent animate-banner-sweep" />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-stone-600 text-xs tracking-wide">Picturing your session…</span>
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
