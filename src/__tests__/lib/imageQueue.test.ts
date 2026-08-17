/**
 * @jest-environment node
 *
 * The queue seam: which driver runs, and what the trace looks like.
 *
 * Two things are worth pinning. First, local development must not need Vercel —
 * `npm run dev` alone has to exercise the whole feature, so the driver falls
 * back to in-process without any queue credentials. Second, the spans follow
 * Sentry's queue conventions (`queue.publish` / `queue.process` with
 * `messaging.*` attributes) and the consumer continues the producer's trace,
 * because a job whose trace is an orphan is far less useful in production.
 */

jest.mock("@/lib/server/sessionImageJob", () => ({
  __esModule: true,
  SESSION_IMAGE_TOPIC: "session-image",
  runSessionImageJob: jest.fn(),
}));

/**
 * Sentry is replaced wholesale rather than spied on.
 *
 * `jest.spyOn` on the imported namespace does not reach the reference the module
 * under test holds, so a spy silently records nothing. Mocking the module is
 * both reliable and a more explicit statement of the contract: pass-through
 * implementations that record the span options they were given. The collectors
 * live inside the factory because `jest.mock` is hoisted above module scope.
 */
jest.mock("@sentry/nextjs", () => {
  const spans: Record<string, unknown>[] = [];
  const attributes: Record<string, unknown> = {};
  const traces: Record<string, unknown>[] = [];

  return {
    __esModule: true,
    __spans: spans,
    __attributes: attributes,
    __traces: traces,
    startSpan: (options: Record<string, unknown>, cb: (span: unknown) => unknown) => {
      spans.push(options);
      return cb({
        setAttribute: (k: string, v: unknown) => { attributes[k] = v },
        setStatus: () => {},
        end: () => {},
      });
    },
    continueTrace: (options: Record<string, unknown>, cb: () => unknown) => {
      traces.push(options);
      return cb();
    },
    withIsolationScope: (cb: () => unknown) => cb(),
    getIsolationScope: () => ({ setUser: () => {} }),
    setTag: () => {},
    getTraceData: () => ({ "sentry-trace": "producer-trace", baggage: "sentry-env=test" }),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    captureException: () => {},
    flush: async () => true,
  };
});

import * as SentryMock from "@sentry/nextjs";
import { runSessionImageJob } from "@/lib/server/sessionImageJob";
import {
  enqueueSessionImage,
  consumeSessionImageJob,
  queueDriver,
  isGenerating,
} from "@/lib/server/imageQueue";

const mockRun = jest.mocked(runSessionImageJob);

const SESSION_ID = "alice-2026-10-05-1";

const job = {
  sessionId: SESSION_ID,
  attempts: 1,
  requestedBy: "bob",
  regenerate: false,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const spans = (SentryMock as any).__spans as Record<string, unknown>[];
const spanAttributes = (SentryMock as any).__attributes as Record<string, unknown>;
const continuedTraces = (SentryMock as any).__traces as Record<string, unknown>[];
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The recorded span options for a given op. */
const spanFor = (op: string) => spans.find((s) => s.op === op);
/** The `attributes` those options carried. */
const attrsFor = (op: string) => spanFor(op)!.attributes as Record<string, unknown>;

let originalDriver: string | undefined;
let originalVercel: string | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  spans.length = 0;
  continuedTraces.length = 0;
  for (const k of Object.keys(spanAttributes)) delete spanAttributes[k];
  originalDriver = process.env.IMAGE_QUEUE_DRIVER;
  originalVercel = process.env.VERCEL;
  mockRun.mockResolvedValue("ready");
});

afterEach(() => {
  process.env.IMAGE_QUEUE_DRIVER = originalDriver;
  process.env.VERCEL = originalVercel;
  if (originalDriver === undefined) delete process.env.IMAGE_QUEUE_DRIVER;
  if (originalVercel === undefined) delete process.env.VERCEL;
});

describe("queueDriver", () => {
  it("runs in-process locally so development needs no Vercel queue", async () => {
    delete process.env.IMAGE_QUEUE_DRIVER;
    delete process.env.VERCEL;
    expect(queueDriver()).toBe("memory");
  });

  it("uses the real queue when running on Vercel", () => {
    delete process.env.IMAGE_QUEUE_DRIVER;
    process.env.VERCEL = "1";
    expect(queueDriver()).toBe("vercel");
  });

  it("lets an explicit setting win either way", () => {
    process.env.VERCEL = "1";
    process.env.IMAGE_QUEUE_DRIVER = "memory";
    expect(queueDriver()).toBe("memory");

    delete process.env.VERCEL;
    process.env.IMAGE_QUEUE_DRIVER = "vercel";
    expect(queueDriver()).toBe("vercel");
  });
});

describe("enqueueSessionImage — memory driver", () => {
  beforeEach(() => {
    process.env.IMAGE_QUEUE_DRIVER = "memory";
  });

  it("returns before the job has finished", async () => {
    // The whole point of the refactor: the request does not wait ~35s for an
    // image. The job is still in flight when the enqueue resolves.
    let completed = false;
    mockRun.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20)); // stands in for the model calls
      completed = true;
      return "ready";
    });

    const result = await enqueueSessionImage({ ...job, sessionId: "mem-1" });

    expect(result.driver).toBe("memory");
    expect(completed).toBe(false);
  });

  it("eventually runs the same job the queue consumer would", async () => {
    await enqueueSessionImage({ ...job, sessionId: "mem-2" });
    await new Promise((r) => setImmediate(r));

    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "mem-2", requestedBy: "bob", attempts: 1 }),
    );
  });

  it("reports a session as generating only while its job runs", async () => {
    let release: () => void = () => {};
    mockRun.mockImplementation(
      () => new Promise((r) => { release = () => r("ready") }),
    );

    await enqueueSessionImage({ ...job, sessionId: "mem-3" });
    expect(isGenerating("mem-3")).toBe(true);

    release();
    await new Promise((r) => setImmediate(r));
    expect(isGenerating("mem-3")).toBe(false);
  });

  it("drops a duplicate request rather than running the job twice", async () => {
    mockRun.mockImplementation(() => new Promise(() => {})); // never settles

    await enqueueSessionImage({ ...job, sessionId: "mem-4" });
    const second = await enqueueSessionImage({ ...job, sessionId: "mem-4" });

    expect(second.deduped).toBe(true);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it("survives a job that throws — one failure must not wedge the process", async () => {
    mockRun.mockRejectedValue(new Error("gateway exploded"));

    await enqueueSessionImage({ ...job, sessionId: "mem-5" });
    await new Promise((r) => setImmediate(r));

    expect(isGenerating("mem-5")).toBe(false);
  });
});

describe("Sentry queue span conventions", () => {
  beforeEach(() => {
    process.env.IMAGE_QUEUE_DRIVER = "memory";
  });

  it("publishes under a queue.publish span naming the destination", async () => {
    await enqueueSessionImage({ ...job, sessionId: "span-1" });

    expect(spanFor("queue.publish")).toBeDefined();
    expect(spanFor("queue.publish")!.name).toBe("queue.publish session-image");
    expect(attrsFor("queue.publish")).toMatchObject({
      "messaging.destination.name": "session-image",
      "messaging.system": "vercel-queues",
    });
    // Known only after the send resolves, so these land via setAttribute.
    expect(spanAttributes["messaging.message.id"]).toEqual(expect.any(String));
    expect(spanAttributes["messaging.message.body.size"]).toEqual(expect.any(Number));
  });

  it("processes under a queue.process span with the consumer-only attributes", async () => {
    await consumeSessionImageJob(
      { ...job, enqueuedAt: Date.now() - 5_000 },
      { messageId: "msg-9", deliveryCount: 3, topicName: "session-image" },
    );

    expect(spanFor("queue.process")).toBeDefined();
    expect(spanFor("queue.process")!.name).toBe("queue.process session-image");

    const a = attrsFor("queue.process");
    expect(a["messaging.message.id"]).toBe("msg-9");
    expect(a["messaging.destination.name"]).toBe("session-image");
    // Deliveries, not attempts: the first delivery is retry 0.
    expect(a["messaging.message.retry.count"]).toBe(2);
    expect(a["messaging.message.receive.latency"]).toBeGreaterThanOrEqual(5_000);
    expect(a["messaging.message.body.size"]).toEqual(expect.any(Number));
  });

  it("prefers the broker's own timestamp for receive latency", async () => {
    await consumeSessionImageJob(
      { ...job, enqueuedAt: 0 }, // would give an absurd latency if used
      {
        messageId: "msg-10",
        deliveryCount: 1,
        topicName: "session-image",
        createdAt: new Date(Date.now() - 1_000),
      },
    );

    expect(attrsFor("queue.process")["messaging.message.receive.latency"]).toBeLessThan(60_000);
  });

  it("carries the producer's trace context to the consumer", async () => {
    // Without this the job's span is an orphan instead of sitting under the page
    // view that asked for the image.
    await consumeSessionImageJob(
      { ...job, enqueuedAt: Date.now(), sentryTrace: "abc-123-1", baggage: "sentry-env=test" },
      { messageId: "msg-11", deliveryCount: 1, topicName: "session-image" },
    );

    expect(continuedTraces).toEqual([
      { sentryTrace: "abc-123-1", baggage: "sentry-env=test" },
    ]);
  });

  it("lets a job failure reach the span so it is recorded as errored", async () => {
    // startSpan marks its span errored when the callback throws, which is how
    // the convention's internal_error status gets set.
    mockRun.mockRejectedValue(new Error("gateway exploded"));

    await expect(
      consumeSessionImageJob(
        { ...job, enqueuedAt: Date.now() },
        { messageId: "msg-12", deliveryCount: 1, topicName: "session-image" },
      ),
    ).rejects.toThrow("gateway exploded");
  });
});
