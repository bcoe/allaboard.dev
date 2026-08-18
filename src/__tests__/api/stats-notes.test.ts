/**
 * @jest-environment node
 *
 * Stats notes — the one read-protected resource in allaboard.
 *
 * Everything else here is publicly viewable; these are not, because a note can
 * record how much someone drank last week. So the property that matters most is
 * that **GET is owner-only too** — a resource that guards its writes and leaks
 * its reads is the failure mode that looks like it followed house style.
 *
 * The second is the scope rule: the week view displays daily notes but must not
 * delete them, and the server enforces that independently of the UI.
 */

jest.mock("next/headers", () => ({ cookies: jest.fn().mockResolvedValue({}) }));
jest.mock("iron-session");
jest.mock("@/lib/server/db", () => {
  const fn = jest.fn();
  Object.assign(fn, { fn: { now: () => "now()" }, raw: (sql: string) => ({ __raw: sql }) });
  return { __esModule: true, default: fn };
});

import { NextRequest } from "next/server";
import db from "@/lib/server/db";
import { getIronSession } from "iron-session";
import { GET, POST } from "@/app/api/users/[handle]/stats-notes/route";
import { DELETE } from "@/app/api/users/[handle]/stats-notes/[id]/route";
import { unauthSession, authSession } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = db as jest.MockedFunction<any>;
const mockGetIronSession = jest.mocked(getIronSession);

/** Chainable query stub. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function qb(opts: { rows?: unknown[]; first?: unknown; inserted?: unknown[] } = {}): Record<string, any> {
  const rows = opts.rows ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: Record<string, any> = {};
  for (const m of ["where", "andWhere", "orderBy", "limit", "select", "modify", "insert"]) {
    q[m] = jest.fn((...a: unknown[]) => { if (m === "modify") (a[0] as (x: unknown) => void)(q); return q });
  }
  q.first = jest.fn().mockResolvedValue(opts.first);
  q.delete = jest.fn().mockResolvedValue(1);
  q.returning = jest.fn().mockResolvedValue(opts.inserted ?? []);
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(res, rej);
  return q;
}

const params = (handle: string, id?: string) => ({ params: Promise.resolve({ handle, id: id ?? "" }) });

const getReq = (qs = "") =>
  new NextRequest(`http://localhost/api/users/alice/stats-notes${qs}`);

const postReq = (body: unknown) =>
  new NextRequest("http://localhost/api/users/alice/stats-notes", {
    method: "POST",
    body: JSON.stringify(body),
  });

const delReq = (scope?: string) =>
  new NextRequest(
    `http://localhost/api/users/alice/stats-notes/n1${scope ? `?scope=${scope}` : ""}`,
    { method: "DELETE" },
  );

const storedRow = {
  id: "n1", scope: "week", category: "dietary",
  data: { flags: ["Stayed well hydrated"], drinks: 4 },
  created_at: "2026-08-17T10:00:00.000Z", period_str: "2026-08-17",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.mockReset();
});

describe("stats notes — privacy", () => {
  it("refuses an unauthenticated read", async () => {
    mockGetIronSession.mockResolvedValue(unauthSession() as never);
    expect((await GET(getReq(), params("alice"))).status).toBe(401);
  });

  it("refuses to let one climber read another's notes", async () => {
    // The point of the whole feature's ACL: notes can be sensitive, so reads are
    // restricted exactly like writes.
    mockGetIronSession.mockResolvedValue(authSession("bob") as never);

    const res = await GET(getReq(), params("alice"));

    expect(res.status).toBe(403);
    expect(mockDb).not.toHaveBeenCalled();
  });

  it("never lets a shared cache hold a note", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb.mockReturnValue(qb({ rows: [storedRow] }));

    const res = await GET(getReq(), params("alice"));

    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns the owner's own notes", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    const q = qb({ rows: [storedRow] });
    mockDb.mockReturnValue(q);

    const body = await (await GET(getReq(), params("alice"))).json();

    expect(q.where).toHaveBeenCalledWith({ user_id: "alice" });
    expect(body.notes[0]).toMatchObject({
      id: "n1", scope: "week", category: "dietary",
      // Formatted by Postgres, so a period can never shift a day in transit.
      period: "2026-08-17",
    });
  });

  it("refuses writes and deletes from anyone but the owner", async () => {
    mockGetIronSession.mockResolvedValue(authSession("bob") as never);

    expect((await POST(postReq({ scope: "day", period: "2026-08-18", category: "sleep", data: {} }), params("alice"))).status).toBe(403);
    expect((await DELETE(delReq("day"), params("alice", "n1"))).status).toBe(403);
  });
});

describe("stats notes — validation", () => {
  beforeEach(() => mockGetIronSession.mockResolvedValue(authSession("alice") as never));

  it("stores a valid note", async () => {
    const q = qb({ inserted: [storedRow] });
    mockDb.mockReturnValue(q);

    const res = await POST(
      postReq({
        scope: "week", period: "2026-08-17", category: "dietary",
        data: { flags: ["Stayed well hydrated"], drinks: 4 },
      }),
      params("alice"),
    );

    expect(res.status).toBe(201);
    expect(q.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "alice", scope: "week", period: "2026-08-17" }),
    );
  });

  it("rejects a weekly-only observation filed against a day", async () => {
    // Diet and sleep have different option lists per scope, and the server checks
    // against the scope's own list rather than a merged one.
    const res = await POST(
      postReq({
        scope: "day", period: "2026-08-18", category: "sleep",
        data: { flags: ["Had trouble sleeping this week"] },
      }),
      params("alice"),
    );

    expect(res.status).toBe(400);
    expect(mockDb).not.toHaveBeenCalled();
  });

  it("rejects a session category on a week, where it makes no sense", async () => {
    const res = await POST(
      postReq({ scope: "week", period: "2026-08-17", category: "outdoor_bouldering", data: {} }),
      params("alice"),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a grade that is not on the scale", async () => {
    const res = await POST(
      postReq({
        scope: "day", period: "2026-08-18", category: "outdoor_climbing",
        data: { hardestRouteSent: "5.16z" },
      }),
      params("alice"),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a malformed period", async () => {
    const res = await POST(
      postReq({ scope: "day", period: "last Tuesday", category: "sleep", data: {} }),
      params("alice"),
    );
    expect(res.status).toBe(400);
  });

  it("accepts a strength session's lifts and weighted pull-ups", async () => {
    mockDb.mockReturnValue(qb({ inserted: [{ ...storedRow, scope: "day", category: "strength" }] }));

    const res = await POST(
      postReq({
        scope: "day", period: "2026-08-18", category: "strength",
        data: {
          lifts: [{ lift: "Deadlift", maxWeight: 180 }, { lift: "Squat" }],
          exercises: [{ exercise: "Pull-up", addedWeight: 20 }, { exercise: "Push-up" }],
        },
      }),
      params("alice"),
    );

    expect(res.status).toBe(201);
  });
});

describe("stats notes — deleting is scoped to the view", () => {
  beforeEach(() => mockGetIronSession.mockResolvedValue(authSession("alice") as never));

  it("deletes a weekly note from the week view", async () => {
    const q = qb({ first: { scope: "week" } });
    mockDb.mockReturnValue(q);

    expect((await DELETE(delReq("week"), params("alice", "n1"))).status).toBe(204);
    expect(q.delete).toHaveBeenCalled();
  });

  it("refuses to delete a daily note from the week view", async () => {
    // The week view shows daily notes so they can be seen in context, but a
    // delete button beside a note you are not in a position to edit is an
    // accident waiting to happen — and the rule holds for a hand-rolled request
    // too, not just the UI.
    const q = qb({ first: { scope: "day" } });
    mockDb.mockReturnValue(q);

    const res = await DELETE(delReq("week"), params("alice", "n1"));

    expect(res.status).toBe(409);
    expect(q.delete).not.toHaveBeenCalled();
  });

  it("refuses to delete a weekly note from the day view", async () => {
    const q = qb({ first: { scope: "week" } });
    mockDb.mockReturnValue(q);

    expect((await DELETE(delReq("day"), params("alice", "n1"))).status).toBe(409);
    expect(q.delete).not.toHaveBeenCalled();
  });

  it("requires a scope, so the rule cannot be skipped by omitting it", async () => {
    expect((await DELETE(delReq(), params("alice", "n1"))).status).toBe(400);
  });

  it("404s a note that is not the caller's", async () => {
    // Scoped by owner in the same query, so another climber's id simply is not
    // found rather than being found and then rejected.
    const q = qb({ first: undefined });
    mockDb.mockReturnValue(q);

    expect((await DELETE(delReq("day"), params("alice", "n1"))).status).toBe(404);
    expect(q.where).toHaveBeenCalledWith({ id: "n1", user_id: "alice" });
  });
});
