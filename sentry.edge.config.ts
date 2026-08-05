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

// Registers the span hook for the edge runtime; the ID itself is read from the
// request headers in `src/middleware.ts`.
instrumentVercelRequestId();

// Wraps the edge runtime's OTel propagator so spans continue Vercel's trace.
// The edge SDK creates the middleware span before user code runs, so
// `src/middleware.ts` also sets the trace on the isolation scope.
instrumentVercelTraceContext();
