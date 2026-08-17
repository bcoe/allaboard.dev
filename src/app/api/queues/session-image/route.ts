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
 * Two model calls plus a crop, so the same budget the inline route used to
 * need. The SDK re-extends the message's visibility lease while this runs.
 */
export const maxDuration = 60;

/**
 * How many times one message may be delivered before it is dropped.
 *
 * Low on purpose: each delivery is a paid image, and `renderWithRetry` already
 * retries the model call once inside a single delivery. Two deliveries is
 * therefore up to four render attempts, which is as much as a transient gateway
 * fault deserves. A message that fails twice has a real problem, and the
 * `failed` row it leaves behind is what the page's retry button acts on.
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
