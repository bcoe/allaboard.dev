/**
 * Puts Sentry's traces on the same trace ID as Vercel's own.
 *
 * On Vercel, the invocation's trace context is not delivered as a header — it
 * is published in-process on `globalThis[Symbol.for("@vercel/request-context")]`
 * as `telemetry.rootSpanContext`, an OTel `SpanContext` belonging to Vercel's
 * infrastructure root span (the routing / middleware / invocation span you see
 * in Session Tracing and Trace Drains). This is the same value `@vercel/otel`
 * reads via its `VercelRuntimePropagator`.
 *
 * Sentry's Node and Edge SDKs are both OpenTelemetry-based and build the
 * request's root span from whatever `propagation.extract()` returns, so we wrap
 * the global propagator Sentry installed: when a request has no trace of its
 * own to continue, Vercel's root span context becomes the parent. Sentry's
 * request span then carries Vercel's trace ID and points at Vercel's infra
 * span, so a Sentry trace and a Vercel trace line up.
 *
 * Precedence — an explicit incoming trace always wins. If the caller sent
 * `sentry-trace`/`baggage` (every navigation from the browser SDK does), we
 * leave it alone; adopting Vercel's trace there would sever pageload → server
 * traces. `@vercel/otel` makes the opposite choice (its propagator runs last in
 * the composite and clobbers the inbound context — vercel/otel#107).
 *
 * No-op outside Vercel (`process.env.VERCEL` unset) and on Vercel whenever the
 * telemetry extension is absent, so local dev and self-hosted runs are
 * unaffected.
 *
 * @see https://github.com/vercel/otel/blob/main/packages/otel/src/vercel-request-context/propagator.ts
 */

import {
  isSpanContextValid,
  propagation,
  trace,
  TraceFlags,
  type Context,
  type SpanContext,
  type TextMapGetter,
  type TextMapPropagator,
  type TextMapSetter,
} from "@opentelemetry/api";
import * as Sentry from "@sentry/nextjs";

/** Where the Vercel runtime publishes the per-invocation request context. */
const VERCEL_REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

/**
 * Where `@opentelemetry/api` keeps its registered globals (`propagation`,
 * `trace`, `context`). We read the propagator back out of it because the public
 * API has a setter but no getter, and `setGlobalPropagator()` refuses to
 * overwrite an existing registration.
 */
const OTEL_API_GLOBALS = Symbol.for("opentelemetry.js.api.1");

/** Minimal shape of the Vercel request context — telemetry is all we need. */
interface VercelRequestContextReader {
  get: () => { telemetry?: { rootSpanContext?: SpanContext } } | undefined;
}

const isVercel = (): boolean => Boolean(process.env.VERCEL);

function readGlobal<T>(key: symbol): T | undefined {
  return (globalThis as unknown as Record<symbol, T | undefined>)[key];
}

/**
 * The `SpanContext` of Vercel's infrastructure root span for the invocation
 * currently being served, or `undefined` when we're not on Vercel, the runtime
 * isn't collecting telemetry for this request, or the IDs are malformed.
 */
export function getVercelRootSpanContext(): SpanContext | undefined {
  if (!isVercel()) return undefined;

  const reader = readGlobal<VercelRequestContextReader>(VERCEL_REQUEST_CONTEXT);
  const rootSpanContext = reader?.get()?.telemetry?.rootSpanContext;

  // isSpanContextValid() checks the trace/span ID formats — the request context
  // is an undocumented runtime detail, so don't trust its shape.
  if (!rootSpanContext || !isSpanContextValid(rootSpanContext)) return undefined;
  return rootSpanContext;
}

/**
 * The trace flags to hand Sentry along with Vercel's span context.
 *
 * Sentry inherits a remote parent's sampling decision verbatim — `sampleSpan()`
 * short-circuits on `parentSampled` before it ever looks at
 * `tracesSampleRate` — so forwarding Vercel's flag would quietly replace our
 * configured sample rate with Vercel's (its own propagator defaults the flag to
 * SAMPLED, which would mean every request). We therefore make the decision here
 * from the configured rate and pass it down as the parent's flag.
 *
 * A `tracesSampler` runs even when a parent decision exists, so when one is
 * configured we forward Vercel's flag and let the sampler have the last word.
 */
function traceFlagsForVercelParent(vercelTraceFlags: number): number {
  const options = Sentry.getClient()?.getOptions();
  if (typeof options?.tracesSampler === "function") return vercelTraceFlags;

  const rate = options?.tracesSampleRate;
  if (rate === undefined) return vercelTraceFlags;

  return Math.random() < Number(rate) ? TraceFlags.SAMPLED : TraceFlags.NONE;
}

/**
 * Wraps the propagator Sentry registered, falling back to Vercel's root span
 * context when the request carries no trace of its own.
 */
class VercelRootSpanContextPropagator implements TextMapPropagator {
  constructor(private readonly inner: TextMapPropagator) {}

  extract<Carrier>(
    context: Context,
    carrier: Carrier,
    getter: TextMapGetter<Carrier>,
  ): Context {
    const extracted = this.inner.extract(context, carrier, getter);

    // The caller sent a trace to continue (e.g. `sentry-trace` from the browser
    // SDK) — that trace wins.
    const incoming = trace.getSpan(extracted)?.spanContext();
    if (incoming && isSpanContextValid(incoming)) return extracted;

    const rootSpanContext = getVercelRootSpanContext();
    if (!rootSpanContext) return extracted;

    return trace.setSpanContext(extracted, {
      ...rootSpanContext,
      isRemote: true,
      traceFlags: traceFlagsForVercelParent(rootSpanContext.traceFlags),
    });
  }

  inject<Carrier>(
    context: Context,
    carrier: Carrier,
    setter: TextMapSetter<Carrier>,
  ): void {
    this.inner.inject(context, carrier, setter);
  }

  fields(): string[] {
    return this.inner.fields();
  }
}

/**
 * Publishes Vercel's trace on the isolation scope, so signals emitted outside
 * any span — errors and logs raised before the request span exists — report the
 * same trace ID instead of minting a fresh one. Spans take their IDs from the
 * OTel context (see the propagator above), not from here.
 */
export function setVercelTraceContext(): void {
  const rootSpanContext = getVercelRootSpanContext();
  if (!rootSpanContext) return;

  const scope = Sentry.getIsolationScope();
  scope.setPropagationContext({
    // Keeps `sampleRand` (and any DSC) the SDK already generated for the request.
    ...scope.getPropagationContext(),
    traceId: rootSpanContext.traceId,
    parentSpanId: rootSpanContext.spanId,
    sampled: (rootSpanContext.traceFlags & TraceFlags.SAMPLED) !== 0,
  });
}

/**
 * Registers the trace-context plumbing. Call once per runtime, immediately
 * after `Sentry.init()` — `Sentry.init()` is what installs the propagator we
 * wrap, and the client we read sampling options from.
 *
 * Safe to call more than once; the wrapper is only installed once per runtime.
 */
export function instrumentVercelTraceContext(): void {
  if (!isVercel()) return;

  const inner = readGlobal<{ propagation?: TextMapPropagator }>(
    OTEL_API_GLOBALS,
  )?.propagation;

  if (!inner) {
    // Sentry sets up OpenTelemetry during init(); if there's no propagator
    // we're either too early or OTel setup was skipped. Leave tracing alone.
    return;
  }
  if (inner instanceof VercelRootSpanContextPropagator) return;

  // setGlobalPropagator() won't overwrite an existing registration, so drop
  // Sentry's first and re-register it inside the wrapper.
  propagation.disable();
  propagation.setGlobalPropagator(new VercelRootSpanContextPropagator(inner));

  const client = Sentry.getClient();
  // Fires after request isolation, before the request is handled.
  client?.on("httpServerRequest", () => setVercelTraceContext());
}
