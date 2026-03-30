import * as Sentry from "@sentry/nextjs";

const isDev = process.env.NODE_ENV === "development";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV, // "development" | "production"

  // Tracing — capture all traces in dev, sample in production
  tracesSampleRate: isDev ? 1.0 : 0.2,

  integrations: [
    Sentry.browserTracingIntegration(),
  ],

  // Log Sentry activity to the browser console in development
  debug: isDev,
});
