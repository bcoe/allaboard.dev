import * as Sentry from "@sentry/nextjs";
import { instrumentVercelRequestId } from "@/lib/server/vercel-request-id";
import { instrumentVercelTraceContext } from "@/lib/server/vercel-trace-context";

const isDev = process.env.NODE_ENV === "development";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,

  tracesSampleRate: isDev ? 1.0 : 0.2,

  // Turn on Sentry structured logs (Sentry.logger.*).
  enableLogs: true,

  debug: isDev,
});

// On Vercel: stamp `vercel-request-id` (from the x-vercel-id request header) on
// spans, logs and metrics. No-op elsewhere.
instrumentVercelRequestId();

// On Vercel: continue Vercel's own trace (its infra root span context, read from
// the request-context global) so Sentry traces share the Vercel trace ID.
// Requests that arrive with their own trace keep it. No-op elsewhere.
instrumentVercelTraceContext();
