---
name: add-sentry-logging
description: Adds Sentry logging to an application using modern best practices for both what to log and how to structure logs.
---

# Add Sentry Logging

This skill adds structured logs to an application following modern best practices for both what to log and how to structure logs.

This skill works within the existing codebase. Prefer the application's existing structured logging abstraction when available. Use `Sentry.logger` only when no structured logging system exists.

Along with adding log lines, this skill configures logging following the Quick Start instructions detailed on the following page: https://sentry.io/quickstart/logs/

## When to use

- User asks to "Configure my repository with Sentry logging".
- User asks to "Setup logging in my application".

## When NOT to use

- Repository is already configured with structured logging and only incremental logs are being added.

## Prerequisites

- Repository is already configured with basic Sentry configuration. If not, direct the user to setup Sentry first.

## Steps

1. Analyze the codebase looking for the following; these represent good candidates for logging:
   - Business events: `checkout_started`, `invoice_paid`, `email_sent`, etc.
   - State transitions: `job_queued`, `job_started`, `job_failed`, `job_retried`.
   - External dependency calls: log failures, retries, timeouts, degraded responses, and meaningful operational events. Don’t log every successful outbound call if spans already capture that.
   - Authorization decisions: denied access, permission mismatch.
   - Data-processing decisions: skipped record, invalid payload, deduped event.
   - Rare branches and fallback paths: this may include describing steps in a complex algorithm, but logs should not be added liberally across many lines of code.

2. Add log lines for the critical steps identified:
   - Log lines should use structured logging.
   - Prefer stable event names and structured fields over dynamically generated log messages.
   - Choose an appropriate log level based on the following guidelines:
     - Use `Error` when an operation fails unexpectedly and requires investigation.
     - Use `Warn` when something unexpected happens, but the system automatically recovers or handles it.
     - Use `Info` for meaningful lifecycle or business events, not every normal step.
   - Log lines should include sufficient detail to begin debugging a problem:
     - If logging HTTP requests, prefer selected safe fields over body snippets. Request/response bodies are a common source of PII and secret leakage.
     - Recommend configuring Sentry `setUser`, so that logs, errors, and traces can be correlated to affected users during investigations: https://docs.sentry.io/platforms/javascript/configuration/apis/#setUser
     - Include sufficient human-readable context in the log message to understand what state transition or decision occurred.
     - `span_id` and `trace_id` generally do not need to be added manually, as Sentry attaches these automatically.

## Avoid

- Logging every successful request or database query.
- Duplicating tracing information already captured in spans.
- Logging full request or response bodies.
- Logging secrets, passwords, tokens, or sensitive PII.
- Adding logs to every line of a complex code path.

## Code patterns

### Node.js

```js
Sentry.init({
  dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
  enableLogs: true,
});
```

```js
Sentry.logger.info("user_logged_in", {
  userId: 123,
});

Sentry.logger.error("payment_failed", {
  orderId: "order_123",
  amount: 99.99,
});
```

#### Node.js: if Pino is already used

```js
Sentry.init({
  enableLogs: true,
  integrations: [Sentry.pinoIntegration()],
});
```

### Python

```py
sentry_sdk.init(
    enable_logs=True,
    dsn="https://examplePublicKey@o0.ingest.sentry.io/0",
)
```

```py
sentry_logger.info(
    "user_logged_in",
    user_id=123,
)

sentry_logger.error(
    "payment_failed",
    order_id="order_123",
    amount=99.99,
)
```

## Out of scope

Sentry also provides tracing , metrics, and errors. Avoid adding log lines that are better represented as tracing telemetry or application KPIs.

Keep the following guidance in mind:

Metrics tell you that something is happening: error rates are rising, latency is increasing, or throughput has dropped. Tracing shows where the problem occurred by following a request through services, database queries, and external dependencies. Logs provide the detailed context needed to understand why a specific operation behaved the way it did: a retry was triggered, a payload was invalid, or a payment provider rejected a request. In practice, metrics detect problems, traces localize them, and logs explain them.

Errors are sent to Sentry when an error path is unhandled, or when captureException is explcitly called with an error object. In these cases we should
not also log a line, as it is redundant.
