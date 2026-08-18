/**
 * Vercel Queues push consumer for session header banners.
 *
 * Vercel invokes this when a message lands on the `session-image` topic; it has
 * no public URL and only the queue infrastructure can reach it (the
 * `experimentalTriggers` entry in `vercel.json` is what makes it private). The
 * work itself lives in `runSessionImageJob`, wrapped by `consumeSessionImageJob`
 * so the `queue.process` span and trace continuation are identical to the local
 * driver's.
 *
 * @module api/queues/session-image
 * @packageDocumentation
 */

import * as Sentry from "@sentry/nextjs";
import { handleCallback } from "@vercel/queue";
import { consumeSessionImageJob } from "@/lib/server/imageQueue";
import type { SessionImageJob } from "@/lib/server/sessionImageJob";

/**
 * How long one delivery may run before Vercel terminates it — five minutes.
 *
 * A measured pipeline is ~41s, and `renderWithRetry` can add roughly another
 * 25s, so the earlier 60s left almost no headroom: a single transient render
 * failure was enough to have the function killed mid-render, which is a stall
 * with no completion log and no `failed` row to retry from.
 *
 * 300s is both the default and the maximum on every plan (Hobby included) now
 * that fluid compute is on by default, so this is the most a delivery can be
 * given without moving to Pro.
 */
export const maxDuration = 300;

/**
 * How long a delivery holds its lease on the message — three minutes.
 *
 * The SDK re-extends this while the handler is alive, so a healthy job is never
 * interrupted by it; what the number really sets is how long the queue waits
 * after a worker stops extending (crashed, frozen, terminated) before handing
 * the message to someone else.
 *
 * It is deliberately shorter than `maxDuration`: a dead worker's message comes
 * back in three minutes rather than five. The cost of that ordering is that if
 * auto-extension ever lapses on a still-running job, the message can be
 * redelivered while the first delivery works on — which is wasted inference,
 * but not corruption, because `runSessionImageJob` is idempotent.
 */
const VISIBILITY_TIMEOUT_SECONDS = 180;

/**
 * How many times one message may be delivered before it is dropped.
 *
 * Low on purpose: each delivery is a paid image, and `renderWithRetry` already
 * retries the model call once inside a single delivery. Two deliveries is
 * therefore up to four render attempts, which is as much as a transient gateway
 * fault deserves. A message that fails twice has a real problem, and the
 * `failed` row it leaves behind is what the page's retry button acts on.
 *
 * This bounds *explicit failures*. A delivery that dies without failing — a
 * termination at `maxDuration` — is governed by the visibility timeout instead,
 * and its redelivery counts against this same budget.
 */
const MAX_DELIVERIES = 2;

/**
 * Process one banner job.
 *
 * **Authentication:** Not applicable — this route is private to Vercel's queue
 * infrastructure and is never called by a browser. Authorization happened when
 * the message was published.
 *
 * Throwing is meaningful here: it leaves the message unacknowledged so Vercel
 * redelivers it. Anything that is not worth retrying is swallowed by the job
 * itself and reported as a skipped outcome instead.
 *
 * @returns `200` once the message is processed (or deliberately abandoned).
 */
export const POST = handleCallback(
  async (message, metadata) => {
    const job = message as SessionImageJob;

    try {
      await consumeSessionImageJob(job, {
        messageId: metadata.messageId,
        deliveryCount: metadata.deliveryCount,
        topicName: metadata.topicName,
        createdAt: metadata.createdAt,
      });
    } finally {
      // Serverless: the instance can be frozen the moment this resolves, so the
      // span and logs have to be on the wire before then.
      await Sentry.flush(2000);
    }
  },
  {
    visibilityTimeoutSeconds: VISIBILITY_TIMEOUT_SECONDS,
    retry: (_error, metadata) => {
      if (metadata.deliveryCount >= MAX_DELIVERIES) {
        // Stop paying for a job that keeps failing. The row already records the
        // failure, and the page offers a manual retry.
        Sentry.logger.warn("Session image job abandoned", {
          "messaging.message.id": metadata.messageId,
          "messaging.message.retry.count": metadata.deliveryCount - 1,
          outcome: "abandoned",
        });
        return { acknowledge: true };
      }
      return { afterSeconds: 10 };
    },
  },
);
