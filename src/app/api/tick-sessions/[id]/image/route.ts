/**
 * Session header image — status and generation requests.
 *
 * `GET` is the public status probe the session page polls; `POST` *asks* for an
 * image and returns immediately, having put a job on the queue. Generation takes
 * 30–40s, which is far too long to hold a request open, so nothing here renders
 * anything: the work happens in `runSessionImageJob`, reached either through
 * Vercel Queues or the local in-memory driver. The bytes themselves are served
 * by the `raw` sub-route.
 *
 * @module api/tick-sessions/id/image
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import db from "@/lib/server/db";
import { resolveUserId } from "@/lib/server/resolveUserId";
import { enqueueSessionImage, isGenerating } from "@/lib/server/imageQueue";

/**
 * Only enqueues now — the 60s budget the inline pipeline needed moved to the
 * consumer. Left explicit because the status read still touches the database.
 */
export const maxDuration = 15;

/**
 * How many times a session may be attempted before it is left alone.
 *
 * Image generation fails transiently often enough that one failure should not
 * be the end of it, but a session that fails repeatedly is failing for a
 * reason that retrying will not fix — and each attempt costs inference.
 */
const MAX_ATTEMPTS = 3;

/** Status as reported to the client. 'none' means no row exists yet. */
type ImageStatus = "none" | "pending" | "ready" | "failed";

/**
 * The client-facing status.
 *
 * `canRetry` is what tells the page whether landing on it should kick off
 * another attempt. Keeping that decision on the server means the retry budget
 * lives in one place rather than being re-derived by every caller.
 *
 * `version` (the row's `updated_at`) is stamped onto the raw URL. The bytes are
 * served `immutable`, so without it a regenerated banner would keep showing the
 * old picture out of cache — for the person who pressed the button and, worse,
 * for everyone who had already loaded the page.
 */
function statusBody(
  sessionId: string,
  status: ImageStatus,
  attempts = 0,
  version?: number,
) {
  const raw = `/api/tick-sessions/${encodeURIComponent(sessionId)}/image/raw`;
  return {
    sessionId,
    status,
    url: status === "ready" ? (version ? `${raw}?v=${version}` : raw) : undefined,
    canRetry: status === "failed" && attempts < MAX_ATTEMPTS,
    attempts,
  };
}

/** Epoch-ms stamp for the cache-busting URL, tolerant of whatever pg returns. */
function versionOf(updatedAt: unknown): number | undefined {
  if (!updatedAt) return undefined;
  const ms = new Date(updatedAt as string).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Report whether this session has a generated header image.
 *
 * **Authentication:** Not required — sessions are public, so their banners are
 * too.
 *
 * @param _req - Incoming request (unused).
 * @param params - Route params. `id` is the session slug
 *   (`<handle>-YYYY-MM-DD-<n>`).
 *
 * @returns `{ sessionId, status, url?, canRetry, attempts }` where `status` is
 *   `none`, `pending`, `ready`, or `failed`. `url` is present only when
 *   `ready`; `canRetry` says whether a failed session still has attempts left.
 *
 * @returns `500` on database error.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = await db("session_images")
      .where({ session_id: id })
      .select("status", "attempts", "updated_at")
      .first();

    return NextResponse.json(
      statusBody(
        id,
        (row?.status as ImageStatus) ?? "none",
        row?.attempts ?? 0,
        versionOf(row?.updated_at),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to read image status" }, { status: 500 });
  }
}

/**
 * Request a header image for this session, queuing the work in the background.
 *
 * **Authentication:** Required — session cookie or `?token=`. Any signed-in
 * climber may request one for any session, not just their own: a session is
 * worth a banner whoever opens it first. Sign-in is still required because each
 * job costs real inference and should be attributable.
 *
 * Returns as soon as the job is accepted — it does **not** wait for the image.
 * Generation takes 30–40s in a background job (Vercel Queues in production, an
 * in-process driver locally); the page polls `GET` for the result.
 *
 * **Nothing is written to the database until an image exists.** A job that dies
 * leaves no trace, which is what makes a session stuck in "generating"
 * unreachable — the only rows that exist describe finished outcomes (`ready`, or
 * `failed` with the reason and attempt count).
 *
 * A refresh is a no-op rather than a second image: the automatic path publishes
 * with an `idempotencyKey` derived from the session and its attempt number, so
 * page views that agree on both collapse to one job. If that misses — different
 * instances, an expired key — two jobs run and the work is idempotent.
 *
 * A session that already has an image is returned as-is and never regenerated,
 * even after new climbs are logged into it, unless `?regenerate=1` asks for a
 * new one outright.
 *
 * @param req - Incoming request. No body. Query parameters:
 *   - `retry=1` — the owner explicitly retrying an exhausted session; resets
 *     the attempt budget. Ignored for anyone but the owner, otherwise a
 *     passer-by could spend a session's retry budget over and over.
 *   - `regenerate=1` — queue a job now, whatever state the session is in:
 *     replace a finished banner, or take over one that failed. Open to any
 *     authenticated caller, published without a dedupe key, and not capped by
 *     the attempt budget — it costs a deliberate press each time, where the
 *     automatic path runs on page load and is budgeted.
 * @param params - Route params. `id` is the session slug.
 *
 * @returns `202` `{ sessionId, status: 'pending', canRetry, attempts, messageId }`
 *   when a job is queued (or an identical one already was).
 *
 * @returns `200` `{ sessionId, status, url?, canRetry, attempts }` when there is
 *   nothing to do — `ready` if the banner already exists (`url` carries a `?v=`
 *   stamp so a replacement is not served from cache), `failed` if the attempt
 *   budget is spent.
 *
 * @returns `401` if not authenticated.
 * @returns `404` if the session does not exist.
 * @returns `500` if the job could not be queued.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await resolveUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const session = await db("tick_sessions").where({ id }).first();
    if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isOwner = session.user_id === userId;

    // `?retry=1` is the owner explicitly asking again after the automatic
    // budget ran out — it resets the counter rather than bypassing the lock.
    // A visitor may generate a missing banner, but not reset a spent budget:
    // the cap is what stops a session that keeps failing from being retried
    // by every person who opens it.
    const force = req.nextUrl.searchParams.get("retry") === "1" && isOwner;

    // `?regenerate=1` is someone asking for a different picture of a session
    // that already has one — the only way past the generate-once rule.
    const regenerate = req.nextUrl.searchParams.get("regenerate") === "1";

    // A job this process started is still running. Reported as in-flight rather
    // than enqueuing a second one.
    if (isGenerating(id)) {
      return NextResponse.json(statusBody(id, "pending"));
    }

    const existing = await db("session_images")
      .where({ session_id: id })
      .select("status", "attempts", "updated_at")
      .first();

    const decision = decideGeneration(existing, { force, regenerate });
    if (decision.outcome !== "generate") {
      Sentry.logger.info("Session image generation skipped", {
        "session.id": id, outcome: "skipped", reason: decision.outcome,
        "image.attempts": decision.attempts,
      });
      const status: ImageStatus = decision.outcome === "exhausted" ? "failed" : "ready";
      return NextResponse.json(statusBody(id, status, decision.attempts, decision.version));
    }

    // A refresh should ride along with the job already queued rather than pay
    // for a second image. Keying on the attempt number gives that for free: two
    // page views read the same `attempts` and so agree on the key, while a
    // *later* attempt (after a recorded failure) gets a different one and is
    // allowed through. A deliberate press sends no key — it should always run.
    const dedupeKey = regenerate
      ? undefined
      : `session-image:${id}:a${decision.attempts}`;

    const queued = await enqueueSessionImage(
      {
        sessionId:   id,
        attempts:    decision.attempts,
        requestedBy: userId,
        regenerate,
      },
      { dedupeKey },
    );

    // 202: the work is accepted, not done. The page polls `GET` for the result.
    return NextResponse.json(
      { ...statusBody(id, "pending", decision.attempts), messageId: queued.messageId },
      { status: 202 },
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to queue image generation" }, { status: 500 });
  }
}

/** The row as read before deciding. */
interface ExistingImage {
  status: string;
  attempts: number;
  updated_at?: unknown;
}

/**
 * Decides whether this request should generate, without writing anything.
 *
 * The old version of this took a lock by inserting a `pending` row, which is
 * what could strand a session in "generating" forever. Deciding is now a pure
 * read: the only rows that exist describe finished outcomes, so there is no
 * in-between state to get stuck in.
 *
 * A `pending` row can still be read here — one left behind by the previous
 * scheme — and is treated exactly like a failure: retryable, and counted
 * against the same budget.
 */
function decideGeneration(
  existing: ExistingImage | undefined,
  { force, regenerate }: { force: boolean; regenerate: boolean },
): {
  outcome: "generate" | "ready" | "exhausted";
  attempts: number;
  version?: number;
} {
  // An explicit ask always generates, whatever state the row is in. It costs a
  // deliberate button press each time, which is what makes it safe to allow
  // where the automatic paths below are capped.
  if (regenerate) return { outcome: "generate", attempts: 1 };

  if (!existing) return { outcome: "generate", attempts: 1 };

  if (existing.status === "ready") {
    return {
      outcome: "ready",
      attempts: existing.attempts,
      version: versionOf(existing.updated_at),
    };
  }

  // 'failed', or a stranded 'pending' from the scheme this replaced.
  if (force) return { outcome: "generate", attempts: 1 };
  if (existing.attempts < MAX_ATTEMPTS) {
    return { outcome: "generate", attempts: existing.attempts + 1 };
  }
  return { outcome: "exhausted", attempts: existing.attempts };
}
