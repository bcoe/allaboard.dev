/**
 * @jest-environment node
 *
 * The background job that actually makes a banner.
 *
 * This used to run inline in the POST handler; it now runs behind a queue, and
 * the queue delivers at least once. So the property that matters most here is
 * **idempotency**: a redelivery, or a second job racing the first, must not
 * corrupt anything or pay for an image that already exists. The other is that
 * nothing reaches the database until there are bytes to write — a job that dies
 * must leave no trace, or a session shows "generating" forever.
 */

jest.mock("@/lib/server/db", () => {
  const fn = jest.fn();
  Object.assign(fn, { fn: { now: () => "now()" }, raw: (sql: string) => ({ __raw: sql }) });
  return { __esModule: true, default: fn };
});
jest.mock("@/lib/server/sessionImage", () => ({
  __esModule: true,
  generateSessionBanner: jest.fn(),
  describeError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
jest.mock("@/lib/server/tickSessions", () => ({
  __esModule: true,
  loadSessionTicks: jest.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import db from "@/lib/server/db";
import { generateSessionBanner } from "@/lib/server/sessionImage";
import { loadSessionTicks } from "@/lib/server/tickSessions";
import { runSessionImageJob, type SessionImageJob } from "@/lib/server/sessionImageJob";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = db as jest.MockedFunction<any>;
const mockGenerate = jest.mocked(generateSessionBanner);
const mockLoadTicks = jest.mocked(loadSessionTicks);

const SESSION_ID = "alice-2026-10-05-1";

const sessionRow = {
  id: SESSION_ID, user_id: "alice", tick_count: 2, sent_count: 1,
  hardest_grade: "V6", total_minutes: 45,
  started_at: "2026-10-05T18:00:00.000Z", ended_at: "2026-10-05T19:30:00.000Z",
};

const banner = {
  prompt: "a sunlit gym wall",
  model: "openai/gpt-image-2",
  mimeType: "image/jpeg",
  bytes: Buffer.from([0xff, 0xd8, 0xff]),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tick = { id: "t1", climbName: "Argh", grade: "V6", comment: "Sent it." } as any;

const job = (over: Partial<SessionImageJob> = {}): SessionImageJob => ({
  sessionId: SESSION_ID,
  attempts: 1,
  requestedBy: "bob",
  regenerate: false,
  enqueuedAt: 1_760_000_000_000,
  ...over,
});

/** Chainable + thenable query-builder stub. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function b(opts: { first?: unknown } = {}): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: Record<string, any> = {};
  for (const m of ["where", "select", "onConflict", "merge", "insert"]) {
    q[m] = jest.fn().mockReturnThis();
  }
  q.first = jest.fn().mockResolvedValue(opts.first);
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve([]).then(res, rej);
  q.catch = (fn: (e: unknown) => unknown) => Promise.resolve([]).catch(fn);
  q.finally = (fn: () => void) => Promise.resolve([]).finally(fn);
  return q;
}

/** Wires up the session row and the current image row. */
function scene(opts: { session?: unknown; existing?: unknown; ticks?: unknown[] } = {}) {
  const images = b({ first: opts.existing });
  mockDb.mockImplementation((table: string) => {
    if (table.startsWith("tick_sessions")) {
      return b({ first: "session" in opts ? opts.session : sessionRow });
    }
    if (table.startsWith("session_images")) return images;
    throw new Error(`unexpected table "${table}"`);
  });
  mockLoadTicks.mockResolvedValue((opts.ticks ?? [tick]) as never);
  return { images };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.mockReset();
  process.env.AI_GATEWAY_API_KEY = "test-key";
});

describe("runSessionImageJob", () => {
  it("stores the banner it generated", async () => {
    mockGenerate.mockResolvedValue(banner);
    const { images } = scene();

    await expect(runSessionImageJob(job())).resolves.toBe("ready");

    expect(images.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: SESSION_ID,
        status: "ready",
        data: banner.bytes,
        mime_type: "image/jpeg",
        model: "openai/gpt-image-2",
      }),
    );
  });

  it("writes nothing before the image exists", async () => {
    let wroteFirst = false;
    const { images } = scene();
    mockGenerate.mockImplementation(async () => {
      wroteFirst = images.insert.mock.calls.length > 0;
      return banner;
    });

    await runSessionImageJob(job());

    expect(wroteFirst).toBe(false);
  });

  it("credits the row to the session's climber, not whoever asked", async () => {
    // user_id is the FK that CASCADE-deletes the banner with an account, so
    // pointing it at a passer-by would take the owner's banner with them.
    mockGenerate.mockResolvedValue(banner);
    const { images } = scene();

    await runSessionImageJob(job({ requestedBy: "bob" }));

    expect(images.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "alice" }),
    );
  });

  it("skips a session that already has an image — a redelivery costs nothing", async () => {
    const { images } = scene({ existing: { status: "ready" } });

    await expect(runSessionImageJob(job())).resolves.toBe("already");

    expect(mockGenerate).not.toHaveBeenCalled();
    expect(images.insert).not.toHaveBeenCalled();
  });

  it("replaces an existing image when the job was asked to regenerate", async () => {
    mockGenerate.mockResolvedValue(banner);
    scene({ existing: { status: "ready" } });

    await expect(runSessionImageJob(job({ regenerate: true }))).resolves.toBe("ready");
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("skips a session that no longer exists", async () => {
    // The tick_sessions trigger rebuilds sessions on every tick change, so a
    // slug can stop existing between enqueue and delivery.
    scene({ session: undefined });

    await expect(runSessionImageJob(job())).resolves.toBe("gone");
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("skips a session with no climbs to draw from", async () => {
    const { images } = scene({ ticks: [] });

    await expect(runSessionImageJob(job())).resolves.toBe("no_climbs");
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(images.insert).not.toHaveBeenCalled();
  });

  it("records the failure and rethrows so the queue can redeliver", async () => {
    mockGenerate.mockRejectedValue(new Error("gateway exploded"));
    const { images } = scene();

    await expect(runSessionImageJob(job({ attempts: 2 }))).rejects.toThrow("gateway exploded");

    // The failure is the one thing worth persisting without an image: it holds
    // the attempt count that bounds retries from later page views.
    expect(images.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error: "gateway exploded", attempts: 2 }),
    );
  });

  it("passes the session's own numbers to the generator", async () => {
    mockGenerate.mockResolvedValue(banner);
    scene();

    await runSessionImageJob(job());

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ id: SESSION_ID, tickCount: 2, sentCount: 1, hardestGrade: "V6" }),
      [tick],
    );
  });
});

// ── Stage logging ─────────────────────────────────────────────────────────────
//
// The job is four slow calls in a row, two of them models, and it runs where
// nobody is watching. Without a record at each step, a job that is picked up and
// stalls is indistinguishable from one that was never delivered — which is
// exactly the hole these logs exist to close.

describe("stage logging", () => {
  let info: jest.SpyInstance;
  let error: jest.SpyInstance;

  /** Log messages in the order they were emitted. */
  const messages = () => info.mock.calls.map((c) => c[0] as string);
  /** Attributes of the named log line. */
  const attrs = (spy: jest.SpyInstance, message: string) =>
    spy.mock.calls.find((c) => c[0] === message)?.[1] as Record<string, unknown> | undefined;

  beforeEach(() => {
    info = jest.spyOn(Sentry.logger, "info").mockImplementation(() => {});
    error = jest.spyOn(Sentry.logger, "error").mockImplementation(() => {});
    jest.spyOn(Sentry, "captureException").mockImplementation(() => "");
  });

  afterEach(() => jest.restoreAllMocks());

  it("records reaching the generate step, before the slow part", async () => {
    mockGenerate.mockResolvedValue(banner);
    scene();

    await runSessionImageJob(job());

    expect(messages()).toEqual([
      "Session image job generating",
      "Session image stored",
    ]);
    expect(attrs(info, "Session image job generating")).toMatchObject({
      "session.id": SESSION_ID,
      "job.stage": "generate",
      tick_count: 1,
      "job.elapsed_ms": expect.any(Number),
    });
  });

  it("names the step that was in flight when a job fails", async () => {
    mockGenerate.mockRejectedValue(new Error("gateway exploded"));
    scene();

    await expect(runSessionImageJob(job())).rejects.toThrow();

    expect(attrs(error, "Session image job failed")).toMatchObject({
      "session.id": SESSION_ID,
      "job.stage": "generate",
      "error.message": "gateway exploded",
      "job.elapsed_ms": expect.any(Number),
    });
  });

  it("blames the database, not the model, when the session read fails", async () => {
    // The stage has to track where execution actually is, or every failure
    // looks like a generation failure.
    mockDb.mockImplementation(() => { throw new Error("connection terminated") });

    await expect(runSessionImageJob(job())).rejects.toThrow("connection terminated");

    expect(attrs(error, "Session image job failed")).toMatchObject({
      "job.stage": "load_session",
    });
  });

  it("says nothing about generating when there is nothing to draw", async () => {
    scene({ ticks: [] });

    await runSessionImageJob(job());

    expect(messages()).toEqual(["Session image job skipped"]);
  });
});
