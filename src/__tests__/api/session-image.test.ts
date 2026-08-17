/**
 * @jest-environment node
 *
 * ACL + contract tests for the session header-image endpoints:
 *   - GET  /api/tick-sessions/[id]/image      (public status probe)
 *   - POST /api/tick-sessions/[id]/image      (queues a job; any signed-in user)
 *   - GET  /api/tick-sessions/[id]/image/raw  (public bytes)
 *
 * The POST handler renders nothing — it decides whether work is warranted and
 * hands a job to the queue, so the queue is mocked here and what the job does
 * is covered by `src/__tests__/lib/sessionImageJob.test.ts`.
 *
 * Each job costs real inference, so what matters most here and is pinned below:
 * it takes an account (never anonymous), a session that already has an image is
 * never queued again, a refresh collapses onto the job already queued, and the
 * retry budget can only be reset by the session's owner. Any signed-in climber
 * may ask for a *missing* banner, on their own session or anyone else's.
 */

import { NextRequest } from "next/server";
import { GET as statusGET, POST } from "@/app/api/tick-sessions/[id]/image/route";
import { GET as rawGET } from "@/app/api/tick-sessions/[id]/image/raw/route";
import { unauthSession, authSession } from "./helpers";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("next/headers", () => ({ cookies: jest.fn().mockResolvedValue({}) }));
jest.mock("iron-session");
jest.mock("@/lib/server/db", () => {
  const fn = jest.fn();
  // The route stamps updated_at with db.fn.now() and increments the attempt
  // counter with db.raw(); the bare jest.fn() default export has neither.
  Object.assign(fn, {
    fn: { now: () => "now()" },
    raw: (sql: string) => ({ __raw: sql }),
  });
  return { __esModule: true, default: fn };
});
jest.mock("@/lib/server/imageQueue", () => ({
  __esModule: true,
  enqueueSessionImage: jest.fn(),
  isGenerating: jest.fn(() => false),
}));

import db from "@/lib/server/db";
import { getIronSession } from "iron-session";
import { enqueueSessionImage, isGenerating } from "@/lib/server/imageQueue";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = db as jest.MockedFunction<any>;
const mockGetIronSession = jest.mocked(getIronSession);
const mockEnqueue = jest.mocked(enqueueSessionImage);
const mockIsGenerating = jest.mocked(isGenerating);

/**
 * Chainable + thenable query-builder stub.
 *
 * Self-contained rather than the shared `qb` helper because these routes use
 * `andWhere`, and need `insert(...).onConflict(...).merge().returning(...)` to
 * resolve to an array.
 */
function b(opts: {
  first?: unknown;
  rows?: unknown[];
  inserted?: unknown[];
  updated?: unknown[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} = {}): Record<string, any> {
  const rows = opts.rows ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: Record<string, any> = {};

  for (const m of ["where", "andWhere", "orWhere", "join", "leftJoin", "orderBy", "select", "onConflict", "ignore", "merge"]) {
    q[m] = jest.fn().mockReturnThis();
  }

  // `returning` resolves to whichever write preceded it in the chain.
  let pending: unknown[] = rows;
  q.insert = jest.fn(() => { pending = opts.inserted ?? []; return q; });
  q.update = jest.fn(() => { pending = opts.updated ?? [{ session_id: "s" }]; return q; });
  q.returning = jest.fn(() => Promise.resolve(pending));
  q.delete = jest.fn().mockResolvedValue(1);
  q.first = jest.fn().mockResolvedValue(opts.first);

  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(res, rej);
  q.catch = (fn: (e: unknown) => unknown) => Promise.resolve(rows).catch(fn);
  q.finally = (fn: () => void) => Promise.resolve(rows).finally(fn);

  return q;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SESSION_ID = "alice-2026-10-05-1";

const sessionRow = {
  id: SESSION_ID, user_id: "alice", date: "2026-10-05", session_number: 1,
  started_at: "2026-10-05T18:00:00.000Z", ended_at: "2026-10-05T19:30:00.000Z",
  tick_count: 2, sent_count: 1, hardest_grade: "V6", total_minutes: 45,
};

/** Stored image bytes, for the raw-bytes route. */
const banner = { bytes: Buffer.from([0xff, 0xd8, 0xff]) };

/**
 * Routes each `db("<table>")` call to a builder by table name.
 *
 * The POST handler used to be tested with an ordered queue of builders, one per
 * statement. That coupled every test to the exact sequence of the claim
 * protocol, so removing the protocol broke all of them at once. Dispatching by
 * table says what each table answers and leaves the handler free to ask in
 * whatever order it likes.
 */
function dispatch(map: Record<string, Record<string, unknown>>) {
  mockDb.mockImplementation((table: string) => {
    const name = table.split(" ")[0]; // "ticks as t" → "ticks"
    const builder = map[name];
    if (!builder) throw new Error(`test did not expect a query against "${table}"`);
    return builder;
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const req = (method: string) =>
  new NextRequest(`http://localhost/api/tick-sessions/${SESSION_ID}/image`, { method });

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks does NOT drain mockReturnValueOnce queues — without this a
  // test that consumes fewer builders than it queued leaks them into the next.
  mockDb.mockReset();
  mockIsGenerating.mockReturnValue(false);
  mockEnqueue.mockResolvedValue({ messageId: "msg-1", deduped: false, driver: "memory" });
});

// ── GET /api/tick-sessions/[id]/image ─────────────────────────────────────────

describe("GET /api/tick-sessions/[id]/image — status", () => {
  it("reports 'none' when no image has ever been requested", async () => {
    mockDb.mockReturnValueOnce(b({ first: undefined }));
    const res = await statusGET(req("GET"), params(SESSION_ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sessionId: SESSION_ID, status: "none", canRetry: false, attempts: 0,
    });
  });

  it("returns a raw-bytes url once the image is ready", async () => {
    mockDb.mockReturnValueOnce(b({ first: { status: "ready" } }));
    const body = await (await statusGET(req("GET"), params(SESSION_ID))).json();
    expect(body).toEqual({
      sessionId: SESSION_ID,
      status: "ready",
      url: `/api/tick-sessions/${SESSION_ID}/image/raw`,
      canRetry: false,
      attempts: 0,
    });
  });

  it("is public — no session cookie is consulted", async () => {
    mockDb.mockReturnValueOnce(b({ first: { status: "ready" } }));
    await statusGET(req("GET"), params(SESSION_ID));
    expect(mockGetIronSession).not.toHaveBeenCalled();
  });

  it("never caches the status response", async () => {
    mockDb.mockReturnValueOnce(b({ first: { status: "pending" } }));
    const res = await statusGET(req("GET"), params(SESSION_ID));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

// ── POST /api/tick-sessions/[id]/image ────────────────────────────────────────
//
// The route no longer renders anything: it decides whether work is warranted
// and puts a job on the queue. What the job itself does is covered by
// src/__tests__/lib/sessionImageJob.test.ts.

/** The timestamp a stored row reports back, for the cache-busting url. */
const UPDATED = new Date("2026-08-17T12:00:00.000Z");

/** Builders for a session plus its current image row. Assert against `.images`. */
function scene(existing?: Record<string, unknown>, id: string = SESSION_ID) {
  const images = b({ first: existing, inserted: [{ updated_at: UPDATED }] });
  dispatch({
    tick_sessions: b({ first: { ...sessionRow, id } }),
    session_images: images,
  });
  return { images };
}

const READY_ROW = { status: "ready", attempts: 1, updated_at: UPDATED };

/** The job argument of the Nth enqueue call. */
const jobOf = (n = 0) => mockEnqueue.mock.calls[n][0];
/** The options argument of the Nth enqueue call. */
const optsOf = (n = 0) => mockEnqueue.mock.calls[n][1] ?? {};

describe("POST /api/tick-sessions/[id]/image — access control", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetIronSession.mockResolvedValue(unauthSession() as never);
    const res = await POST(req("POST"), params(SESSION_ID));
    expect(res.status).toBe(401);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("queues a banner for someone else's session on a signed-in visit", async () => {
    mockGetIronSession.mockResolvedValue(authSession("bob") as never);
    scene(); // session owned by alice

    const res = await POST(req("POST"), params(SESSION_ID));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ status: "pending" });
    expect(jobOf()).toMatchObject({ sessionId: SESSION_ID, requestedBy: "bob" });
  });

  it("returns 404 when the session does not exist", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    dispatch({ tick_sessions: b({ first: undefined }) });
    expect((await POST(req("POST"), params(SESSION_ID))).status).toBe(404);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

describe("POST /api/tick-sessions/[id]/image — queuing", () => {
  beforeEach(() => mockGetIronSession.mockResolvedValue(authSession("alice") as never));

  it("returns without waiting for the image", async () => {
    // 202, not 201: the work is accepted, not done. Generation takes 30–40s,
    // which is why it is not on this request's clock at all.
    scene();
    const res = await POST(req("POST"), params(SESSION_ID));

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ status: "pending", messageId: "msg-1" });
  });

  it("writes nothing to the database", async () => {
    const { images } = scene();
    await POST(req("POST"), params(SESSION_ID));

    // No claim row, no placeholder — the job writes only once it has bytes.
    expect(images.insert).not.toHaveBeenCalled();
    expect(images.update).not.toHaveBeenCalled();
  });

  it("makes a refresh ride along with the job already queued", async () => {
    // Two page views read the same attempt number, so they agree on the dedupe
    // key and the queue collapses them into one job.
    scene();
    await POST(req("POST"), params(SESSION_ID));
    await POST(req("POST"), params(SESSION_ID));

    expect(optsOf(0).dedupeKey).toBe(`session-image:${SESSION_ID}:a1`);
    expect(optsOf(1).dedupeKey).toBe(optsOf(0).dedupeKey);
  });

  it("uses a different key for a later attempt so a failure can be retried", async () => {
    scene({ status: "failed", attempts: 1 });
    await POST(req("POST"), params(SESSION_ID));

    expect(jobOf().attempts).toBe(2);
    expect(optsOf().dedupeKey).toBe(`session-image:${SESSION_ID}:a2`);
  });

  it("reports in-flight work in this process without queuing again", async () => {
    mockIsGenerating.mockReturnValue(true);
    scene();

    const res = await POST(req("POST"), params(SESSION_ID));
    expect(await res.json()).toMatchObject({ status: "pending" });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("does not queue anything for a session that already has an image", async () => {
    scene(READY_ROW);

    const res = await POST(req("POST"), params(SESSION_ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ready" });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("leaves a session alone once its attempts are spent", async () => {
    scene({ status: "failed", attempts: 3 });

    const res = await POST(req("POST"), params(SESSION_ID));
    expect(await res.json()).toMatchObject({ status: "failed", canRetry: false, attempts: 3 });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("picks up a session stranded mid-generation by a dead request", async () => {
    // A leftover 'pending' row from the scheme that wrote one before generating.
    scene({ status: "pending", attempts: 1 });

    expect((await POST(req("POST"), params(SESSION_ID))).status).toBe(202);
    expect(jobOf().attempts).toBe(2);
  });
});

// ── Regeneration ──────────────────────────────────────────────────────────────

describe("POST /api/tick-sessions/[id]/image?regenerate=1", () => {
  const regenReq = (id: string = SESSION_ID) =>
    new NextRequest(
      `http://localhost/api/tick-sessions/${id}/image?regenerate=1`,
      { method: "POST" },
    );

  it("queues a replacement for a finished banner", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    scene(READY_ROW);

    expect((await POST(regenReq(), params(SESSION_ID))).status).toBe(202);
    expect(jobOf()).toMatchObject({ sessionId: SESSION_ID, regenerate: true });
  });

  it("sends no dedupe key — a deliberate press always runs", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    scene(READY_ROW);

    await POST(regenReq(), params(SESSION_ID));
    expect(optsOf().dedupeKey).toBeUndefined();
  });

  it("is available to any signed-in climber, not just the session's owner", async () => {
    mockGetIronSession.mockResolvedValue(authSession("bob") as never);
    scene(READY_ROW); // owned by alice

    expect((await POST(regenReq(), params(SESSION_ID))).status).toBe(202);
    expect(jobOf().requestedBy).toBe("bob");
  });

  it("requires authentication", async () => {
    mockGetIronSession.mockResolvedValue(unauthSession() as never);
    expect((await POST(regenReq(), params(SESSION_ID))).status).toBe(401);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("rescues a session whose automatic retries are spent", async () => {
    // Uncapped on purpose: this costs a deliberate press each time, where the
    // page-load path that the budget protects runs on its own.
    mockGetIronSession.mockResolvedValue(authSession("bob") as never);
    scene({ status: "failed", attempts: 3 });

    expect((await POST(regenReq(), params(SESSION_ID))).status).toBe(202);
    expect(jobOf().attempts).toBe(1);
  });

  it("still refuses to queue without the flag", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    scene(READY_ROW);

    const body = await (await POST(req("POST"), params(SESSION_ID))).json();
    expect(body).toMatchObject({
      status: "ready",
      url: `/api/tick-sessions/${SESSION_ID}/image/raw?v=${UPDATED.getTime()}`,
    });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

// ── GET /api/tick-sessions/[id]/image/raw ─────────────────────────────────────

describe("GET /api/tick-sessions/[id]/image/raw", () => {
  it("serves the stored bytes with an immutable cache header", async () => {
    mockDb.mockReturnValueOnce(b({ first: { data: banner.bytes, mime_type: "image/jpeg" } }));
    const res = await rawGET(req("GET"), params(SESSION_ID));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(banner.bytes);
  });

  it("returns 404 when no image has been generated", async () => {
    mockDb.mockReturnValueOnce(b({ first: undefined }));
    expect((await rawGET(req("GET"), params(SESSION_ID))).status).toBe(404);
  });
});

// ── Retry after failure ───────────────────────────────────────────────────────
//
// Image generation fails transiently. These pin the recovery path: a failed
// session is queued again on the next visit, but only while it has budget left.

describe("POST /api/tick-sessions/[id]/image — retry after failure", () => {
  beforeEach(() => mockGetIronSession.mockResolvedValue(authSession("alice") as never));

  it("queues a failed session again while attempts remain", async () => {
    scene({ status: "failed", attempts: 1 });

    expect((await POST(req("POST"), params(SESSION_ID))).status).toBe(202);
    expect(jobOf().attempts).toBe(2);
  });

  it("resets the budget when the owner explicitly retries with ?retry=1", async () => {
    scene({ status: "failed", attempts: 3 }); // exhausted

    const forced = new NextRequest(
      `http://localhost/api/tick-sessions/${SESSION_ID}/image?retry=1`,
      { method: "POST" },
    );
    expect((await POST(forced, params(SESSION_ID))).status).toBe(202);
    expect(jobOf().attempts).toBe(1);
  });

  it("ignores ?retry=1 from anyone but the owner", async () => {
    mockGetIronSession.mockResolvedValue(authSession("bob") as never);
    scene({ status: "failed", attempts: 3 }); // owned by alice, budget spent

    const forced = new NextRequest(
      `http://localhost/api/tick-sessions/${SESSION_ID}/image?retry=1`,
      { method: "POST" },
    );
    const body = await (await POST(forced, params(SESSION_ID))).json();

    // The flag was dropped, so the spent budget still applies.
    expect(body).toMatchObject({ status: "failed", canRetry: false });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("reports a fresh failure as retryable so the next visit picks it up", async () => {
    dispatch({
      tick_sessions: b({ first: sessionRow }),
      session_images: b({ first: { status: "failed", attempts: 1, updated_at: UPDATED } }),
    });

    const res = await statusGET(req("GET"), params(SESSION_ID));
    expect(await res.json()).toMatchObject({ status: "failed", canRetry: true, attempts: 1 });
  });
});
