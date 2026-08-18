/**
 * Enqueues session-banner work, and runs it locally when there is no queue.
 *
 * Generation takes 30–40s, which is too long to hold a request open, so the
 * page view only *asks* for an image and polls for it. Two drivers back that
 * ask:
 *
 *   - **`vercel`** (production) — publishes to a Vercel Queues topic. Vercel
 *     invokes the push consumer at `src/app/api/queues/session-image/route.ts`,
 *     which gets durability, at-least-once delivery and redelivery for free.
 *   - **`memory`** (local) — runs the same job in this process, detached from
 *     the request. Nothing to install, no `vercel link`, no OIDC token: `npm
 *     run dev` alone is enough to exercise the whole feature.
 *
 * The driver is chosen by `IMAGE_QUEUE_DRIVER` if set, else `vercel` when
 * running on Vercel (`process.env.VERCEL`), else `memory`. Fire-and-forget is
 * only safe in the memory driver because a local dev server keeps running after
 * the response; a Vercel function may be frozen the moment it responds, which
 * is the whole reason production needs a real queue.
 *
 * Both drivers emit the same producer/consumer span pair, so a local trace has
 * the shape of a production one.
 *
 * Server-only. Never imported by client code.
 */

import * as Sentry from "@sentry/nextjs";
import {
  SESSION_IMAGE_TOPIC,
  runSessionImageJob,
  type SessionImageJob,
} from "@/lib/server/sessionImageJob";

export type QueueDriver = "vercel" | "memory";

/**
 * How long a queued job stays alive — and therefore how long its dedupe key
 * holds.
 *
 * Vercel ties the `idempotencyKey` deduplication window to the message's
 * lifetime, so retention is really two settings at once. The default (24h)
 * would be wrong here: the automatic key is derived from the session's attempt
 * count, so a job lost *without* recording a failure would leave that count
 * unchanged, every later page view would recompute the same key, and automatic
 * generation would be silently deduped away for a day. Only the corner button
 * (which publishes without a key) could recover it.
 *
 * Five minutes makes that window self-healing instead: long enough that a
 * refresh during a ~40s job still collapses onto it — with room for the one
 * retry the consumer allows — and short enough that a lost job is retried on the
 * next visit rather than a day later.
 */
const RETENTION_SECONDS = 300;

/**
 * Which driver this process uses.
 *
 * Read through a function rather than a module constant so tests and
 * `.env.local` can change it without the import order mattering.
 */
export function queueDriver(): QueueDriver {
  const explicit = process.env.IMAGE_QUEUE_DRIVER;
  if (explicit === "vercel" || explicit === "memory") return explicit;
  return process.env.VERCEL ? "vercel" : "memory";
}

/**
 * Sessions whose job this process started and has not finished.
 *
 * Best-effort deduplication, and the only kind available without writing a row
 * before the work is done — which is what used to leave sessions stuck showing
 * "generating" forever. It makes a page refresh a no-op locally, and on Vercel
 * within one warm instance; `idempotencyKey` covers the distributed case. When
 * both miss, two jobs run and `runSessionImageJob` is idempotent, which is the
 * documented worst case rather than a bug.
 *
 * Anchored to `globalThis` so it survives Next.js module re-evaluation in dev.
 */
declare global { var __sessionImageInFlight: Set<string> | undefined }

if (!globalThis.__sessionImageInFlight) globalThis.__sessionImageInFlight = new Set();
const inFlight = globalThis.__sessionImageInFlight;

/** True while this process is generating a banner for `sessionId`. */
export function isGenerating(sessionId: string): boolean {
  return inFlight.has(sessionId);
}

/** What the caller needs to know about an enqueue. */
export interface EnqueueResult {
  /** Queue message id, or a local marker for the memory driver. */
  messageId: string;
  /** True when an identical job was already queued and this one was dropped. */
  deduped: boolean;
  driver: QueueDriver;
}

/**
 * Asks for a banner for `sessionId`, returning as soon as the work is accepted.
 *
 * `dedupeKey`, when given, becomes the queue's `idempotencyKey`: two requests
 * that agree on it produce one job, for as long as that job lives
 * (`RETENTION_SECONDS`). Omit it for a deliberate press, which should always
 * run.
 */
export async function enqueueSessionImage(
  job: Omit<SessionImageJob, "sentryTrace" | "baggage" | "enqueuedAt">,
  { dedupeKey }: { dedupeKey?: string } = {},
): Promise<EnqueueResult> {
  const driver = queueDriver();

  // Producer span, per Sentry's queue conventions. The trace context captured
  // inside it is what the consumer continues, so the job appears under the page
  // view that asked for it.
  return Sentry.startSpan(
    {
      name: `queue.publish ${SESSION_IMAGE_TOPIC}`,
      op: "queue.publish",
      attributes: {
        "messaging.destination.name": SESSION_IMAGE_TOPIC,
        "messaging.system": "vercel-queues",
        "queue.driver": driver,
        "session.id": job.sessionId,
      },
    },
    async (span) => {
      const traceData = Sentry.getTraceData();
      const payload: SessionImageJob = {
        ...job,
        sentryTrace: traceData["sentry-trace"],
        baggage: traceData.baggage,
        enqueuedAt: Date.now(),
      };

      const bodySize = Buffer.byteLength(JSON.stringify(payload), "utf8");
      span.setAttribute("messaging.message.body.size", bodySize);

      const result =
        driver === "vercel"
          ? await publishToVercel(payload, dedupeKey)
          : runInThisProcess(payload);

      span.setAttribute("messaging.message.id", result.messageId);
      span.setAttribute("messaging.message.deduped", result.deduped);

      Sentry.logger.info("Session image job enqueued", {
        "session.id": job.sessionId,
        "queue.driver": driver,
        "queue.topic": SESSION_IMAGE_TOPIC,
        "messaging.message.id": result.messageId,
        "messaging.message.deduped": result.deduped,
        "image.attempts": job.attempts,
        "image.regenerated": job.regenerate,
      });

      return { ...result, driver };
    },
  );
}

/** Publishes to the real topic. A duplicate key is a success, not a failure. */
async function publishToVercel(
  payload: SessionImageJob,
  dedupeKey: string | undefined,
): Promise<{ messageId: string; deduped: boolean }> {
  // Imported lazily so local development never loads the SDK — it resolves
  // credentials from the Vercel environment and has nothing to talk to here.
  const { send, DuplicateMessageError } = await import("@vercel/queue");

  try {
    const { messageId } = await send(SESSION_IMAGE_TOPIC, payload, {
      retentionSeconds: RETENTION_SECONDS,
      ...(dedupeKey ? { idempotencyKey: dedupeKey } : {}),
    });
    // The SDK types messageId as nullable; the message is still accepted
    // without one, so don't fail the request over a missing trace attribute.
    return { messageId: messageId ?? "unknown", deduped: false };
  } catch (err) {
    if (err instanceof DuplicateMessageError) {
      // Exactly the intended outcome of a refresh: a job for this session is
      // already queued, so this request quietly rides along with it.
      return { messageId: dedupeKey ?? "duplicate", deduped: true };
    }
    throw err;
  }
}

/**
 * Runs the job in this process, detached from the request.
 *
 * Deliberately not awaited: the caller returns immediately and the page polls,
 * which is the behaviour being emulated. Errors are swallowed after being
 * recorded — an unhandled rejection would take the dev server down, and the
 * failure is already on the row and in Sentry.
 */
function runInThisProcess(payload: SessionImageJob): { messageId: string; deduped: boolean } {
  if (inFlight.has(payload.sessionId)) {
    return { messageId: `local:${payload.sessionId}`, deduped: true };
  }

  inFlight.add(payload.sessionId);
  const messageId = `local:${payload.sessionId}:${payload.enqueuedAt}`;

  void consumeSessionImageJob(payload, {
    messageId,
    deliveryCount: 1,
    topicName: SESSION_IMAGE_TOPIC,
  })
    .catch(() => {
      // Already recorded on the row and captured by Sentry inside the job.
    })
    .finally(() => {
      inFlight.delete(payload.sessionId);
    });

  return { messageId, deduped: false };
}

/** The consumer-side facts a span needs, from either driver. */
export interface ConsumerMetadata {
  messageId: string;
  deliveryCount: number;
  topicName: string;
  createdAt?: Date;
}

/**
 * Runs a job under a `queue.process` span that continues the producer's trace.
 *
 * Shared by the Vercel push consumer and the local driver so both produce the
 * same span shape. Rethrows on failure, having let the span record the error —
 * on Vercel that rethrow is what triggers redelivery.
 */
export async function consumeSessionImageJob(
  job: SessionImageJob,
  metadata: ConsumerMetadata,
): Promise<void> {
  const receiveLatency = Date.now() - (metadata.createdAt?.getTime() ?? job.enqueuedAt);

  await Sentry.continueTrace(
    { sentryTrace: job.sentryTrace, baggage: job.baggage },
    () =>
      // A fresh isolation scope per message: without it, tags and breadcrumbs
      // from one job leak into the next on a warm instance.
      Sentry.withIsolationScope(async () => {
        Sentry.setTag("feature", "session_image");
        Sentry.getIsolationScope().setUser({ id: job.requestedBy });

        return Sentry.startSpan(
          {
            name: `queue.process ${metadata.topicName}`,
            op: "queue.process",
            forceTransaction: true,
            attributes: {
              "messaging.message.id": metadata.messageId,
              "messaging.destination.name": metadata.topicName,
              "messaging.system": "vercel-queues",
              // Deliveries, not attempts: the first delivery is retry 0.
              "messaging.message.retry.count": Math.max(0, metadata.deliveryCount - 1),
              "messaging.message.receive.latency": receiveLatency,
              "messaging.message.body.size": Buffer.byteLength(JSON.stringify(job), "utf8"),
              "session.id": job.sessionId,
              "image.attempts": job.attempts,
            },
          },
          async (span) => {
            // The first thing a job records, and the one that answers "was this
            // message ever picked up?". Flushed immediately rather than left in
            // the buffer: if the function is later killed — a 60s timeout, a
            // freeze — nothing else in this invocation reaches Sentry, and the
            // difference between "never delivered" and "delivered, then stalled"
            // is exactly what that buffer would have swallowed.
            Sentry.logger.info("Session image job received", {
              "session.id": job.sessionId,
              "messaging.message.id": metadata.messageId,
              "messaging.destination.name": metadata.topicName,
              "messaging.message.retry.count": Math.max(0, metadata.deliveryCount - 1),
              "messaging.message.receive.latency": receiveLatency,
              "image.attempts": job.attempts,
              "image.regenerated": job.regenerate,
              "image.requested_by": job.requestedBy,
            });
            await Sentry.flush(2000);

            const startedAt = Date.now();
            try {
              // startSpan marks the span errored if this throws, which is how the
              // convention's internal_error status gets set.
              const outcome = await runSessionImageJob(job);
              span.setAttribute("job.outcome", outcome);

              Sentry.logger.info("Session image job finished", {
                "session.id": job.sessionId,
                "messaging.message.id": metadata.messageId,
                "job.outcome": outcome,
                "job.duration_ms": Date.now() - startedAt,
              });
            } catch (err) {
              // The exception itself goes to Sentry from inside the job, where
              // the stage is known. This is the queue-level counterpart: it says
              // the delivery failed and how long it burned before doing so,
              // which is what distinguishes a fast rejection from a timeout.
              Sentry.logger.error("Session image job threw", {
                "session.id": job.sessionId,
                "messaging.message.id": metadata.messageId,
                "messaging.message.retry.count": Math.max(0, metadata.deliveryCount - 1),
                "job.duration_ms": Date.now() - startedAt,
                "error.message": err instanceof Error ? err.message : String(err),
              });
              throw err;
            }
          },
        );
      }),
  );
}
