/**
 * Correlates Sentry telemetry with Vercel's own request logs.
 *
 * Vercel stamps every incoming request with an `x-vercel-id` header (the
 * invocation's request ID). When we're running on Vercel and that header is
 * present we publish it as `vercel-request-id` so it lands on everything Sentry
 * emits for the request — spans, logs, metrics and error events — making it
 * possible to jump from a Sentry event to the matching Vercel invocation.
 *
 * No-op outside Vercel (`process.env.VERCEL` unset) or when the header is
 * absent, so local dev and self-hosted runs are unaffected.
 */

import * as Sentry from "@sentry/nextjs";

export const VERCEL_REQUEST_ID_ATTRIBUTE = "vercel-request-id";

const HEADER = "x-vercel-id";

const isVercel = (): boolean => Boolean(process.env.VERCEL);

/**
 * The request ID of the invocation currently being served, mirroring what we
 * put on the global scope. Read by the `spanStart` hook below — scope
 * attributes reach logs and metrics today, but not yet spans.
 */
let currentRequestId: string | undefined;

/**
 * Publishes `requestId` as `vercel-request-id` on every signal:
 *
 * - **logs + metrics** — scope attributes; both read the combined scope data.
 * - **spans** — the in-flight span here, plus the `spanStart` hook below for
 *   spans opened later in the request. Scope attributes don't reach spans yet.
 * - **error events** — as a *tag*. `applyDataToEvent()` ignores scope
 *   attributes, and `Event` has no attributes field, so a tag is the only way
 *   to get the ID onto an error (and it's the searchable field in Sentry).
 */
export function setVercelRequestId(requestId: string | undefined | null): void {
  if (!isVercel() || !requestId) return;

  currentRequestId = requestId;
  Sentry.getGlobalScope()
    .setAttributes({ [VERCEL_REQUEST_ID_ATTRIBUTE]: requestId })
    .setTag(VERCEL_REQUEST_ID_ATTRIBUTE, requestId);

  // Spans already in flight when we learn the ID (e.g. the middleware span)
  // won't be seen by the `spanStart` hook, so stamp the current one directly.
  const activeSpan = Sentry.getActiveSpan();
  if (activeSpan) {
    Sentry.getRootSpan(activeSpan).setAttribute(
      VERCEL_REQUEST_ID_ATTRIBUTE,
      requestId,
    );
  }
}

/** Reads `x-vercel-id` off a `Headers` object (edge runtime / middleware). */
export function setVercelRequestIdFromHeaders(headers: Headers): void {
  if (!isVercel()) return;
  setVercelRequestId(headers.get(HEADER));
}

/**
 * Registers the Sentry client hooks that keep `vercel-request-id` up to date.
 * Call once per runtime, immediately after `Sentry.init()`.
 *
 * - `httpServerRequest` fires after request isolation but before the request is
 *   handled, so the ID is in place before any route handler telemetry.
 * - `spanStart` stamps each span as it opens, since scope attributes are not
 *   yet applied to spans by the SDK.
 */
export function instrumentVercelRequestId(): void {
  if (!isVercel()) return;

  const client = Sentry.getClient();
  if (!client) return;

  client.on("httpServerRequest", (_request, _response, normalizedRequest) => {
    setVercelRequestId(normalizedRequest.headers?.[HEADER]);
  });

  client.on("spanStart", (span) => {
    if (currentRequestId) {
      span.setAttribute(VERCEL_REQUEST_ID_ATTRIBUTE, currentRequestId);
    }
  });
}
