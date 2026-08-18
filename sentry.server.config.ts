import * as Sentry from "@sentry/nextjs";

const isDev = process.env.NODE_ENV === "development";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,

  tracesSampleRate: isDev ? 1.0 : 1.0,

  // Turn on Sentry structured logs (Sentry.logger.*).
  enableLogs: true,

  integrations: [
    // Node enables this integration by default, but prompts and completions are
    // *not* recorded unless asked for — reasonably, since for most apps they are
    // user data. Here the conversation is the climber's own logbook read back to
    // them, and Sentry's Conversations view is only worth having if it can show
    // what was actually said.
    Sentry.vercelAIIntegration({ recordInputs: true, recordOutputs: true }),
  ],

  debug: isDev,
});
