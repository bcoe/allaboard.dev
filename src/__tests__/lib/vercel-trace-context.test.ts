/**
 * @jest-environment node
 *
 * Unit tests for src/lib/server/vercel-trace-context.ts — continuing Vercel's
 * trace (its infra root span context, published on the request-context global)
 * so Sentry traces carry the same trace ID.
 *
 * These run against the real `@opentelemetry/api` so the propagator wrapping is
 * exercised end to end: a stub propagator stands in for the one Sentry
 * registers, and `propagation.extract()` drives the code under test.
 *
 * Test scenarios:
 *  - Outside Vercel (VERCEL unset)     → no context read, propagator untouched
 *  - Telemetry extension absent        → no-op
 *  - Malformed rootSpanContext         → ignored
 *  - No incoming trace                 → Vercel's span context becomes parent
 *  - Incoming trace (sentry-trace)     → left alone, Vercel's trace ignored
 *  - Sampling                          → traceFlags follow tracesSampleRate,
 *                                        or Vercel's flag when a tracesSampler
 *                                        is configured
 *  - Isolation scope                   → propagation context adopts the trace
 *  - Repeat registration               → wrapper installed only once
 */

import {
  context as otelContext,
  propagation,
  trace,
  TraceFlags,
  type Context,
  type SpanContext,
  type TextMapPropagator,
} from "@opentelemetry/api";

const VERCEL_TRACE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const VERCEL_SPAN_ID = "bbbbbbbbbbbbbbbb";
const INCOMING_TRACE_ID = "cccccccccccccccccccccccccccccccc";
const INCOMING_SPAN_ID = "dddddddddddddddd";

const clientOn = jest.fn();
const setPropagationContext = jest.fn();
const getPropagationContext = jest.fn(() => ({
  traceId: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  sampleRand: 0.42,
}));

let options: Record<string, unknown> = { tracesSampleRate: 1 };

jest.mock("@sentry/nextjs", () => ({
  getClient: () => ({ getOptions: () => options, on: clientOn }),
  getIsolationScope: () => ({ setPropagationContext, getPropagationContext }),
}));

/**
 * Stands in for the propagator Sentry installs. Extracts a span context when
 * the carrier carries our stub trace header, mirroring how SentryPropagator
 * returns the context untouched when there is no incoming trace.
 */
const innerPropagator: TextMapPropagator = {
  extract: (ctx, carrier, getter) => {
    const incoming = getter.get(carrier, "stub-trace");
    if (!incoming) return ctx;
    return trace.setSpanContext(ctx, {
      traceId: INCOMING_TRACE_ID,
      spanId: INCOMING_SPAN_ID,
      traceFlags: TraceFlags.SAMPLED,
      isRemote: true,
    });
  },
  inject: jest.fn(),
  fields: () => ["stub-trace"],
};

/** Installs a Vercel request context exposing `rootSpanContext`. */
function setVercelRequestContext(
  telemetry: { rootSpanContext?: Partial<SpanContext> } | undefined,
): void {
  (globalThis as Record<symbol, unknown>)[
    Symbol.for("@vercel/request-context")
  ] = { get: () => (telemetry ? { telemetry } : {}) };
}

function clearVercelRequestContext(): void {
  delete (globalThis as Record<symbol, unknown>)[
    Symbol.for("@vercel/request-context")
  ];
}

/** Runs the global propagator's extract() over a carrier. */
function extract(carrier: Record<string, string> = {}): Context {
  return propagation.extract(otelContext.active(), carrier);
}

/** The parent span context extract() produced, if any. */
function parentOf(ctx: Context): SpanContext | undefined {
  return trace.getSpan(ctx)?.spanContext();
}

async function loadModule() {
  jest.resetModules();
  return import("@/lib/server/vercel-trace-context");
}

describe("vercel-trace-context", () => {
  const originalVercel = process.env.VERCEL;

  beforeEach(() => {
    clientOn.mockClear();
    setPropagationContext.mockClear();
    options = { tracesSampleRate: 1 };
    process.env.VERCEL = "1";

    propagation.disable();
    propagation.setGlobalPropagator(innerPropagator);
    setVercelRequestContext({
      rootSpanContext: {
        traceId: VERCEL_TRACE_ID,
        spanId: VERCEL_SPAN_ID,
        traceFlags: TraceFlags.SAMPLED,
      },
    });
  });

  afterEach(() => {
    propagation.disable();
    clearVercelRequestContext();
  });

  afterAll(() => {
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  });

  it("is a no-op when not running on Vercel", async () => {
    delete process.env.VERCEL;
    const mod = await loadModule();

    mod.instrumentVercelTraceContext();

    expect(mod.getVercelRootSpanContext()).toBeUndefined();
    expect(parentOf(extract())).toBeUndefined();
    expect(clientOn).not.toHaveBeenCalled();
  });

  it("is a no-op when the Vercel telemetry extension is absent", async () => {
    setVercelRequestContext(undefined);
    const mod = await loadModule();
    mod.instrumentVercelTraceContext();

    expect(mod.getVercelRootSpanContext()).toBeUndefined();
    expect(parentOf(extract())).toBeUndefined();
  });

  it("ignores a malformed root span context", async () => {
    setVercelRequestContext({
      rootSpanContext: { traceId: "nope", spanId: "nope", traceFlags: 1 },
    });
    const mod = await loadModule();
    mod.instrumentVercelTraceContext();

    expect(mod.getVercelRootSpanContext()).toBeUndefined();
    expect(parentOf(extract())).toBeUndefined();
  });

  it("continues Vercel's trace when the request has none of its own", async () => {
    const mod = await loadModule();
    mod.instrumentVercelTraceContext();

    const parent = parentOf(extract());

    expect(parent).toMatchObject({
      traceId: VERCEL_TRACE_ID,
      spanId: VERCEL_SPAN_ID,
      isRemote: true,
    });
  });

  it("leaves an incoming trace alone", async () => {
    const mod = await loadModule();
    mod.instrumentVercelTraceContext();

    const parent = parentOf(extract({ "stub-trace": "yes" }));

    expect(parent?.traceId).toBe(INCOMING_TRACE_ID);
    expect(parent?.spanId).toBe(INCOMING_SPAN_ID);
  });

  it("delegates inject() and fields() to the wrapped propagator", async () => {
    const mod = await loadModule();
    mod.instrumentVercelTraceContext();

    const carrier: Record<string, string> = {};
    propagation.inject(otelContext.active(), carrier);

    expect(innerPropagator.inject).toHaveBeenCalled();
    expect(propagation.fields()).toEqual(["stub-trace"]);
  });

  // Sentry inherits a remote parent's decision verbatim, so the flag we hand it
  // has to be the real decision — otherwise tracesSampleRate is bypassed.
  it("applies tracesSampleRate to the inherited sampling decision", async () => {
    options = { tracesSampleRate: 0 };
    const mod = await loadModule();
    mod.instrumentVercelTraceContext();

    expect(parentOf(extract())?.traceFlags).toBe(TraceFlags.NONE);

    options = { tracesSampleRate: 1 };
    expect(parentOf(extract())?.traceFlags).toBe(TraceFlags.SAMPLED);
  });

  it("forwards Vercel's flag when a tracesSampler is configured", async () => {
    options = { tracesSampleRate: 0, tracesSampler: () => 0 };
    const mod = await loadModule();
    mod.instrumentVercelTraceContext();

    // Vercel said sampled; the tracesSampler gets to decide, not us.
    expect(parentOf(extract())?.traceFlags).toBe(TraceFlags.SAMPLED);
  });

  it("adopts Vercel's trace on the isolation scope", async () => {
    const mod = await loadModule();

    mod.setVercelTraceContext();

    expect(setPropagationContext).toHaveBeenCalledWith({
      traceId: VERCEL_TRACE_ID,
      parentSpanId: VERCEL_SPAN_ID,
      sampled: true,
      sampleRand: 0.42, // carried over from the existing propagation context
    });
  });

  it("registers the httpServerRequest hook once", async () => {
    const mod = await loadModule();

    mod.instrumentVercelTraceContext();
    mod.instrumentVercelTraceContext();

    expect(clientOn).toHaveBeenCalledTimes(1);
    expect(clientOn.mock.calls[0][0]).toBe("httpServerRequest");
  });

  it("leaves tracing alone when no propagator is registered", async () => {
    propagation.disable();
    const mod = await loadModule();

    mod.instrumentVercelTraceContext();

    expect(parentOf(extract())).toBeUndefined();
    expect(clientOn).not.toHaveBeenCalled();
  });
});
