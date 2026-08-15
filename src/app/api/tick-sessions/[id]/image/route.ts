/**
 * Session header image — status and generation.
 *
 * `GET` is the public status probe the session page polls; `POST` runs the
 * (slow, paid) generation and is restricted to the climber whose session it
 * is. The bytes themselves are served by the `raw` sub-route.
 *
 * @module api/tick-sessions/id/image
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import db from "@/lib/server/db";
import { resolveUserId } from "@/lib/server/resolveUserId";
import { loadSessionTicks } from "@/lib/server/tickSessions";
import { generateSessionBanner, describeError } from "@/lib/server/sessionImage";

/**
 * Both model calls run inline, so the request is held for the whole pipeline
 * (~20–30s). Kept at 60 to stay inside the Vercel Hobby ceiling.
 */
export const maxDuration = 60;

/**
 * How long a 'pending' row is trusted before another request may reclaim it.
 * Guards against a row left pending forever by a process that died mid-call.
 */
const PENDING_STALE_MS = 5 * 60 * 1000;

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
 */
function statusBody(sessionId: string, status: ImageStatus, attempts = 0) {
  return {
    sessionId,
    status,
    url: status === "ready" ? `/api/tick-sessions/${encodeURIComponent(sessionId)}/image/raw` : undefined,
    canRetry: status === "failed" && attempts < MAX_ATTEMPTS,
    attempts,
  };
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
      .select("status", "attempts")
      .first();

    return NextResponse.json(
      statusBody(id, (row?.status as ImageStatus) ?? "none", row?.attempts ?? 0),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to read image status" }, { status: 500 });
  }
}

/**
 * Generate the header image for this session, if one does not already exist.
 *
 * **Authentication:** Required — session cookie or `?token=`. Only the
 * climber who logged the session may trigger generation (`403` otherwise),
 * since each call costs real inference.
 *
 * Generation is idempotent: the handler claims the job by inserting a
 * `pending` row with `ON CONFLICT DO NOTHING`, so concurrent requests for the
 * same session cannot both generate. A session that already has an image is
 * returned as-is and never regenerated, even after new climbs are logged into
 * it.
 *
 * Failures are retryable but bounded. A `failed` row is reclaimed on the next
 * request while `attempts` remain (3), as is a `pending` row left stranded for
 * more than five minutes by a process that died mid-call. Once the budget is
 * spent the session is left alone and reports `canRetry: false`.
 *
 * @param req - Incoming request. No body. Query parameter:
 *   - `retry=1` — the owner explicitly retrying an exhausted session; resets
 *     the attempt budget. Still subject to the `pending` lock.
 * @param params - Route params. `id` is the session slug.
 *
 * @returns `{ sessionId, status, url?, canRetry, attempts }` — `ready` once
 *   the image is stored, `pending` if another request is already generating
 *   it, `failed` if this attempt (or the budget) ran out.
 *
 * @returns `401` if not authenticated.
 * @returns `403` if the caller does not own the session.
 * @returns `404` if the session does not exist.
 * @returns `422` if the session has no climbs to draw from.
 * @returns `502` if the image could not be generated.
 * @returns `500` on database error.
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

    if (session.user_id !== userId) {
      // Permission event: someone tried to spend inference on another climber's session.
      Sentry.logger.warn("Forbidden session image generation", {
        action: "create", resource: "session_image", "session.id": id,
        owner: session.user_id, outcome: "forbidden",
      });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // `?retry=1` is the owner explicitly asking again after the automatic
    // budget ran out — it resets the counter rather than bypassing the lock.
    const force = req.nextUrl.searchParams.get("retry") === "1";

    const claim = await claimGeneration(id, userId, force);
    if (claim.outcome !== "claimed") {
      // Already ready, mid-flight, or out of retries — never generate twice.
      Sentry.logger.info("Session image generation skipped", {
        "session.id": id, outcome: "skipped", reason: claim.outcome,
        "image.attempts": claim.attempts,
      });
      const status: ImageStatus = claim.outcome === "exhausted" ? "failed" : claim.outcome;
      return NextResponse.json(statusBody(id, status, claim.attempts));
    }

    const ticks = await loadSessionTicks(session);
    if (ticks.length === 0) {
      await db("session_images").where({ session_id: id }).delete();
      return NextResponse.json({ error: "Session has no climbs" }, { status: 422 });
    }

    let banner;
    try {
      banner = await generateSessionBanner(
        {
          id:           session.id,
          tickCount:    session.tick_count,
          sentCount:    session.sent_count,
          hardestGrade: session.hardest_grade ?? undefined,
          totalMinutes: session.total_minutes ?? undefined,
        },
        ticks,
      );
    } catch (err) {
      // Release the claim so the next visit can retry, and record why it
      // failed in a form that is actually diagnosable later.
      const reason = describeError(err);
      await db("session_images").where({ session_id: id }).update({
        status: "failed",
        error: reason,
        updated_at: db.fn.now(),
      });
      Sentry.captureException(err, {
        tags: { feature: "session_image" },
        extra: { session_id: id, attempts: claim.attempts },
      });
      return NextResponse.json(statusBody(id, "failed", claim.attempts), { status: 502 });
    }

    await db("session_images").where({ session_id: id }).update({
      status:     "ready",
      model:      banner.model,
      prompt:     banner.prompt,
      mime_type:  banner.mimeType,
      data:       banner.bytes,
      error:      null,
      updated_at: db.fn.now(),
    });

    // Audit event: an image now exists for this session, and who caused it.
    Sentry.logger.info("Session image stored", {
      action: "create", resource: "session_image", "session.id": id,
      "ai.image_model": banner.model, "image.bytes": banner.bytes.length, outcome: "ready",
    });

    return NextResponse.json(statusBody(id, "ready", claim.attempts), { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to generate image" }, { status: 500 });
  }
}

/**
 * Attempts to take ownership of generation for `sessionId`.
 *
 * Returns `"claimed"` when this request should generate, or the current status
 * when it should not: `"ready"` (already generated — the no-regeneration rule)
 * or `"pending"` (another request got there first).
 */
async function claimGeneration(
  sessionId: string,
  userId: string,
  force: boolean,
): Promise<{ outcome: "claimed" | "ready" | "pending" | "exhausted"; attempts: number }> {
  // First writer wins; everyone else falls through to the status read below.
  const inserted = await db("session_images")
    .insert({ session_id: sessionId, user_id: userId, status: "pending", attempts: 1 })
    .onConflict("session_id")
    .ignore()
    .returning("session_id");

  if (inserted.length > 0) return { outcome: "claimed", attempts: 1 };

  const existing = await db("session_images")
    .where({ session_id: sessionId })
    .select("status", "attempts", "updated_at")
    .first();

  // Row vanished between the two statements — race is harmless.
  if (!existing) return { outcome: "claimed", attempts: 1 };
  if (existing.status === "ready") return { outcome: "ready", attempts: existing.attempts };

  // A failed attempt is retryable while budget remains, and so is a pending
  // row whose generator clearly died. An explicit retry from the owner resets
  // the budget — they asked for it, so they get a fresh set of attempts.
  // Re-claim atomically so two retries can't both proceed.
  const stale = new Date(Date.now() - PENDING_STALE_MS);
  const reclaimed = await db("session_images")
    .where({ session_id: sessionId })
    .where((q) =>
      q
        .where((f) => {
          f.where({ status: "failed" });
          if (!force) f.andWhere("attempts", "<", MAX_ATTEMPTS);
        })
        .orWhere((p) =>
          p.where({ status: "pending" }).andWhere("updated_at", "<", stale),
        ),
    )
    .update({
      status:     "pending",
      user_id:    userId,
      error:      null,
      attempts:   force ? 1 : db.raw("attempts + 1"),
      updated_at: db.fn.now(),
    })
    .returning("attempts");

  if (reclaimed.length > 0) {
    return { outcome: "claimed", attempts: reclaimed[0]?.attempts ?? existing.attempts + 1 };
  }

  // Nothing to reclaim: either someone else is mid-flight, or this session has
  // spent its retry budget and should be left alone.
  return {
    outcome: existing.status === "failed" ? "exhausted" : "pending",
    attempts: existing.attempts,
  };
}
