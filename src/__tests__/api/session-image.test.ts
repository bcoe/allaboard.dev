/**
 * @jest-environment node
 *
 * ACL + contract tests for the session header-image endpoints:
 *   - GET  /api/tick-sessions/[id]/image      (public status probe)
 *   - POST /api/tick-sessions/[id]/image      (generation; any signed-in user)
 *   - GET  /api/tick-sessions/[id]/image/raw  (public bytes)
 *
 * Generation costs real inference, so what matters most here and is pinned
 * below: it takes an account (never anonymous), a session that already has an
 * image is never regenerated, and the retry budget can only be reset by the
 * session's owner. Any signed-in climber may make a *missing* banner, for
 * their own session or anyone else's.
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
jest.mock("@/lib/server/sessionImage", () => ({
  __esModule: true,
  generateSessionBanner: jest.fn(),
  // The route uses the real flattener to build the stored error string.
  describeError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import db from "@/lib/server/db";
import { getIronSession } from "iron-session";
import { generateSessionBanner } from "@/lib/server/sessionImage";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = db as jest.MockedFunction<any>;
const mockGetIronSession = jest.mocked(getIronSession);
const mockGenerate = jest.mocked(generateSessionBanner);

/**
 * Chainable + thenable query-builder stub.
 *
 * Self-contained rather than the shared `qb` helper because this route uses
 * `andWhere`, and needs `insert(...).onConflict(...).ignore().returning(...)`
 * and `update(...).returning(...)` to resolve to arrays (the claim protocol
 * reads their length).
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

  for (const m of ["where", "andWhere", "orWhere", "join", "leftJoin", "orderBy", "select", "onConflict", "ignore"]) {
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

const tickRow = {
  id: "tick-1", climb_id: "climb-1", climb_name: "Argh", grade: "V6",
  board_name: "Kilter Board (Original)", angle: 40,
  date: "2026-10-05T18:10:00.000Z", sent: true, rating: 4,
  comment: "What a triumph.", suggested_grade: null, instagram_url: null,
  attempts: 12, duration_minutes: 40, created_at: "2026-10-05T18:10:00.000Z",
};

const banner = {
  prompt: "a dim stone wall",
  model: "bfl/flux-2-max",
  mimeType: "image/jpeg",
  bytes: Buffer.from([0xff, 0xd8, 0xff]),
};

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const req = (method: string) =>
  new NextRequest(`http://localhost/api/tick-sessions/${SESSION_ID}/image`, { method });

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks does NOT drain mockReturnValueOnce queues — without this a
  // test that consumes fewer builders than it queued leaks them into the next.
  mockDb.mockReset();
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

describe("POST /api/tick-sessions/[id]/image — access control", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetIronSession.mockResolvedValue(unauthSession() as never);
    const res = await POST(req("POST"), params(SESSION_ID));
    expect(res.status).toBe(401);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("lets a signed-in visitor generate a banner for someone else's session", async () => {
    mockGetIronSession.mockResolvedValue(authSession("bob") as never);
    mockGenerate.mockResolvedValue(banner);

    const store = b({ inserted: [{ session_id: SESSION_ID }] });
    mockDb
      .mockReturnValueOnce(b({ first: sessionRow })) // owned by alice
      .mockReturnValueOnce(store)                    // claim insert
      .mockReturnValueOnce(b({ rows: [tickRow] }))   // session ticks
      .mockReturnValueOnce(store);                   // store result

    const res = await POST(req("POST"), params(SESSION_ID));
    expect(res.status).toBe(201);
    expect(mockGenerate).toHaveBeenCalledTimes(1);

    // The row belongs to the session's climber, never the passer-by who paid
    // for it: user_id is the FK that CASCADE-deletes the banner along with an
    // account, so pointing it at bob would take alice's banner with him.
    expect(store.insert).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: SESSION_ID, user_id: "alice" }),
    );
  });

  it("returns 404 when the session does not exist", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb.mockReturnValueOnce(b({ first: undefined }));
    expect((await POST(req("POST"), params(SESSION_ID))).status).toBe(404);
  });
});

describe("POST /api/tick-sessions/[id]/image — generation", () => {
  beforeEach(() => mockGetIronSession.mockResolvedValue(authSession("alice") as never));

  it("generates and stores an image for the owner", async () => {
    mockGenerate.mockResolvedValue(banner);

    const store = b({ inserted: [{ session_id: SESSION_ID }] }); // claim succeeds
    mockDb
      .mockReturnValueOnce(b({ first: sessionRow })) // tick_sessions lookup
      .mockReturnValueOnce(store)                    // claim insert
      .mockReturnValueOnce(b({ rows: [tickRow] }))   // session ticks
      .mockReturnValueOnce(store);                   // store result

    const res = await POST(req("POST"), params(SESSION_ID));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: "ready" });

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    // The notes must reach the generator — they are what the image is drawn from.
    expect(mockGenerate.mock.calls[0][1][0].comment).toBe("What a triumph.");
    expect(store.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ready", mime_type: "image/jpeg", data: banner.bytes }),
    );
  });

  it("does not regenerate a session that already has an image", async () => {
    mockDb
      .mockReturnValueOnce(b({ first: sessionRow }))                  // session lookup
      .mockReturnValueOnce(b({ inserted: [] }))                       // claim loses the conflict
      .mockReturnValueOnce(b({ first: { status: "ready", attempts: 1, updated_at: new Date() } }));

    const res = await POST(req("POST"), params(SESSION_ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ready" });
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("reports 'pending' without generating when another request holds the claim", async () => {
    mockDb
      .mockReturnValueOnce(b({ first: sessionRow }))
      .mockReturnValueOnce(b({ inserted: [] }))
      .mockReturnValueOnce(b({ first: { status: "pending", attempts: 1, updated_at: new Date() } }))
      .mockReturnValueOnce(b({ updated: [] })); // too fresh to reclaim

    const res = await POST(req("POST"), params(SESSION_ID));
    expect(await res.json()).toMatchObject({ status: "pending" });
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("returns 422 and releases the claim when the session has no climbs", async () => {
    const store = b({ inserted: [{ session_id: SESSION_ID }] });
    mockDb
      .mockReturnValueOnce(b({ first: sessionRow }))
      .mockReturnValueOnce(store)
      .mockReturnValueOnce(b({ rows: [] })) // no ticks in the window
      .mockReturnValueOnce(store);

    const res = await POST(req("POST"), params(SESSION_ID));
    expect(res.status).toBe(422);
    expect(store.delete).toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("marks the row failed (502) when the model call throws", async () => {
    mockGenerate.mockRejectedValue(new Error("gateway exploded"));

    const store = b({ inserted: [{ session_id: SESSION_ID }] });
    mockDb
      .mockReturnValueOnce(b({ first: sessionRow }))
      .mockReturnValueOnce(store)
      .mockReturnValueOnce(b({ rows: [tickRow] }))
      .mockReturnValueOnce(store);

    const res = await POST(req("POST"), params(SESSION_ID));
    expect(res.status).toBe(502);
    expect(store.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error: "gateway exploded" }),
    );
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
// session tries again on the next visit, but only while it has budget left.

describe("POST /api/tick-sessions/[id]/image — retry after failure", () => {
  beforeEach(() => mockGetIronSession.mockResolvedValue(authSession("alice") as never));

  it("re-claims a failed session and generates again while attempts remain", async () => {
    mockGenerate.mockResolvedValue(banner);

    const store = b({ inserted: [], updated: [{ attempts: 2 }] });
    mockDb
      .mockReturnValueOnce(b({ first: sessionRow }))                                  // session lookup
      .mockReturnValueOnce(store)                                                     // claim insert loses
      .mockReturnValueOnce(b({ first: { status: "failed", attempts: 1 } }))           // existing row
      .mockReturnValueOnce(store)                                                     // reclaim update
      .mockReturnValueOnce(b({ rows: [tickRow] }))                                    // session ticks
      .mockReturnValueOnce(store);                                                    // store result

    const res = await POST(req("POST"), params(SESSION_ID));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: "ready" });
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("counts the attempt so repeated failures cannot retry forever", async () => {
    mockGenerate.mockResolvedValue(banner);

    const store = b({ inserted: [], updated: [{ attempts: 2 }] });
    mockDb
      .mockReturnValueOnce(b({ first: sessionRow }))
      .mockReturnValueOnce(store)
      .mockReturnValueOnce(b({ first: { status: "failed", attempts: 1 } }))
      .mockReturnValueOnce(store)
      .mockReturnValueOnce(b({ rows: [tickRow] }))
      .mockReturnValueOnce(store);

    await POST(req("POST"), params(SESSION_ID));

    // The reclaim increments rather than resetting.
    expect(store.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", attempts: { __raw: "attempts + 1" } }),
    );
  });

  it("leaves a session alone once its attempts are spent", async () => {
    mockDb
      .mockReturnValueOnce(b({ first: sessionRow }))
      .mockReturnValueOnce(b({ inserted: [] }))
      .mockReturnValueOnce(b({ first: { status: "failed", attempts: 3 } }))
      .mockReturnValueOnce(b({ updated: [] })); // budget spent — nothing to reclaim

    const res = await POST(req("POST"), params(SESSION_ID));
    expect(await res.json()).toMatchObject({ status: "failed", canRetry: false, attempts: 3 });
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("resets the budget when the owner explicitly retries with ?retry=1", async () => {
    mockGenerate.mockResolvedValue(banner);

    const store = b({ inserted: [], updated: [{ attempts: 1 }] });
    mockDb
      .mockReturnValueOnce(b({ first: sessionRow }))
      .mockReturnValueOnce(store)
      .mockReturnValueOnce(b({ first: { status: "failed", attempts: 3 } })) // exhausted
      .mockReturnValueOnce(store)
      .mockReturnValueOnce(b({ rows: [tickRow] }))
      .mockReturnValueOnce(store);

    const forced = new NextRequest(
      `http://localhost/api/tick-sessions/${SESSION_ID}/image?retry=1`,
      { method: "POST" },
    );

    const res = await POST(forced, params(SESSION_ID));
    expect(res.status).toBe(201);
    expect(store.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", attempts: 1 }),
    );
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("ignores ?retry=1 from anyone but the owner", async () => {
    mockGetIronSession.mockResolvedValue(authSession("bob") as never);
    mockGenerate.mockResolvedValue(banner);

    const store = b({ inserted: [], updated: [{ attempts: 4 }] });
    mockDb
      .mockReturnValueOnce(b({ first: sessionRow }))                        // owned by alice
      .mockReturnValueOnce(store)                                           // claim insert loses
      .mockReturnValueOnce(b({ first: { status: "failed", attempts: 3 } })) // budget spent
      .mockReturnValueOnce(store)                                           // reclaim attempt
      .mockReturnValueOnce(b({ rows: [tickRow] }))
      .mockReturnValueOnce(store);

    const forced = new NextRequest(
      `http://localhost/api/tick-sessions/${SESSION_ID}/image?retry=1`,
      { method: "POST" },
    );
    await POST(forced, params(SESSION_ID));

    // Incremented, not reset to 1 — the flag was dropped. (Against real
    // Postgres the `attempts < 3` predicate in that same UPDATE is what then
    // matches nothing; the stub can't evaluate it, so what is pinned here is
    // that a visitor never gets `force`.)
    expect(store.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", attempts: { __raw: "attempts + 1" } }),
    );
  });

  it("reports a fresh failure as retryable so the next visit picks it up", async () => {
    mockGenerate.mockRejectedValue(new Error("Invalid JSON response"));

    const store = b({ inserted: [{ session_id: SESSION_ID }] });
    mockDb
      .mockReturnValueOnce(b({ first: sessionRow }))
      .mockReturnValueOnce(store)
      .mockReturnValueOnce(b({ rows: [tickRow] }))
      .mockReturnValueOnce(store);

    const res = await POST(req("POST"), params(SESSION_ID));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ status: "failed", canRetry: true, attempts: 1 });
  });
});
