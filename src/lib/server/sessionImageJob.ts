/**
 * The background job that produces a session's header banner.
 *
 * This is the whole unit of work, and it is deliberately the *same* code on
 * both sides of the queue: Vercel's push consumer
 * (`src/app/api/queues/session-image/route.ts`) and the local in-memory driver
 * (`src/lib/server/imageQueue.ts`) each call `runSessionImageJob`. A bug that
 * only reproduces in production because the two paths diverged is exactly what
 * this arrangement is meant to rule out.
 *
 * Server-only. Never imported by client code.
 */

import * as Sentry from "@sentry/nextjs";
import db from "@/lib/server/db";
import { loadSessionTicks } from "@/lib/server/tickSessions";
import { generateSessionBanner, describeError } from "@/lib/server/sessionImage";

/** The queue topic. Also the `messaging.destination.name` in Sentry traces. */
export const SESSION_IMAGE_TOPIC = "session-image";

/**
 * What the producer puts on the queue.
 *
 * `sentryTrace` / `baggage` carry the producer's trace context so the consumer
 * span joins the trace of the page view that asked for the image, rather than
 * starting an orphan. They live in the payload rather than in the message
 * headers because the consumer `metadata` the SDK exposes does not include
 * headers.
 */
export interface SessionImageJob {
  sessionId: string;
  /** Which attempt this represents, for the cross-visit retry budget. */
  attempts: number;
  /** Handle of whoever's page view triggered this — audit only. */
  requestedBy: string;
  /** True when replacing a banner the session already has. */
  regenerate: boolean;
  /** Producer trace context (`sentry-trace` / `baggage` header values). */
  sentryTrace?: string;
  baggage?: string;
  /** Enqueue time in epoch ms — the fallback for receive latency. */
  enqueuedAt: number;
}

/** Why a job ended, for logs and for the consumer's span attributes. */
export type JobOutcome =
  | "ready"        // an image was generated and stored
  | "gone"         // the session no longer exists
  | "already"      // someone else produced one first; nothing to do
  | "no_climbs";   // nothing to draw from

/**
 * Generates and stores the banner described by `job`.
 *
 * **Idempotent by design.** Two jobs for the same session running at once is
 * allowed to happen — the queue guarantees at-least-once delivery, and a page
 * refresh may enqueue a second one — so this never assumes it is alone. It
 * re-reads the session and the current row, skips if a banner already exists
 * (unless it was asked to replace one), and finishes with an upsert. Worst case
 * two jobs both render and the later write wins; nothing is corrupted and no
 * row is left half-written.
 *
 * Throws only on a generation failure, after recording it. The caller decides
 * whether that becomes a queue redelivery.
 */
export async function runSessionImageJob(job: SessionImageJob): Promise<JobOutcome> {
  const { sessionId, attempts, regenerate } = job;

  const session = await db("tick_sessions").where({ id: sessionId }).first();
  if (!session) {
    // The tick_sessions trigger rebuilds sessions on every tick change, so a
    // slug can genuinely stop existing between enqueue and delivery.
    Sentry.logger.info("Session image job skipped", {
      "session.id": sessionId, outcome: "skipped", reason: "gone",
    });
    return "gone";
  }

  // Re-read rather than trusting the producer's decision: with at-least-once
  // delivery this job may be a redelivery of one that already succeeded.
  const existing = await db("session_images")
    .where({ session_id: sessionId })
    .select("status")
    .first();

  if (existing?.status === "ready" && !regenerate) {
    Sentry.logger.info("Session image job skipped", {
      "session.id": sessionId, outcome: "skipped", reason: "already",
    });
    return "already";
  }

  const ticks = await loadSessionTicks(session);
  if (ticks.length === 0) {
    Sentry.logger.info("Session image job skipped", {
      "session.id": sessionId, outcome: "skipped", reason: "no_climbs",
    });
    return "no_climbs";
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
    // The failure is the one thing worth persisting without an image: it holds
    // the attempt count that bounds retries from later page views, and a reason
    // that is diagnosable afterwards.
    await recordFailure(sessionId, session.user_id, attempts, describeError(err));
    Sentry.captureException(err, {
      tags: { feature: "session_image" },
      extra: { session_id: sessionId, attempts },
    });
    throw err;
  }

  await storeBanner(sessionId, session.user_id, attempts, banner);

  // Audit event: the actor may not be the session's owner, so record both —
  // who caused the spend, and whose session it bought a banner for.
  Sentry.logger.info("Session image stored", {
    action: existing ? "update" : "create", resource: "session_image",
    "session.id": sessionId, owner: session.user_id,
    "image.requested_by": job.requestedBy, "image.regenerated": regenerate,
    "ai.image_model": banner.model, "image.bytes": banner.bytes.length,
    "image.attempts": attempts, outcome: "ready",
  });

  return "ready";
}

/**
 * Records a failed attempt.
 *
 * An upsert rather than an update: nothing is written before generation, so the
 * first failure for a session has no row to update.
 */
async function recordFailure(
  sessionId: string,
  ownerId: string,
  attempts: number,
  reason: string,
): Promise<void> {
  await db("session_images")
    .insert({
      session_id: sessionId,
      user_id:    ownerId,
      status:     "failed",
      attempts,
      error:      reason,
      updated_at: db.fn.now(),
    })
    .onConflict("session_id")
    .merge(["status", "attempts", "error", "updated_at"]);
}

/**
 * Writes the finished banner — the only path that stores image bytes.
 *
 * `user_id` is the session's climber, not whoever asked for the image: that
 * column is the FK that CASCADE-deletes the banner along with an account, so it
 * has to follow the session rather than the passer-by who opened it.
 */
async function storeBanner(
  sessionId: string,
  ownerId: string,
  attempts: number,
  banner: { model: string; prompt: string; mimeType: string; bytes: Buffer },
): Promise<void> {
  await db("session_images")
    .insert({
      session_id: sessionId,
      user_id:    ownerId,
      status:     "ready",
      attempts,
      model:      banner.model,
      prompt:     banner.prompt,
      mime_type:  banner.mimeType,
      data:       banner.bytes,
      error:      null,
      updated_at: db.fn.now(),
    })
    .onConflict("session_id")
    .merge(["user_id", "status", "attempts", "model", "prompt", "mime_type", "data", "error", "updated_at"]);
}
