/**
 * @jest-environment node
 *
 * API contract tests for GET /api/leaderboard
 */

import { NextRequest } from "next/server";
import { GET } from "@/app/api/leaderboard/route";

jest.mock("@/lib/server/db", () => ({ __esModule: true, default: jest.fn() }));

import db from "@/lib/server/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = db as jest.MockedFunction<any>;

// ── Query-builder stub ────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function qb(arrayResult: unknown = [], firstResult?: unknown): Record<string, any> {
  const first =
    firstResult !== undefined
      ? firstResult
      : Array.isArray(arrayResult)
      ? (arrayResult as unknown[])[0]
      : arrayResult;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: Record<string, any> = {};
  for (const m of [
    "where", "whereIn", "whereNotNull", "join", "leftJoin", "orderBy",
    "select", "groupBy", "as", "insert",
  ]) {
    b[m] = jest.fn().mockReturnThis();
  }
  b.update = jest.fn().mockResolvedValue(1);
  b.first  = jest.fn().mockResolvedValue(first);
  b.then   = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(arrayResult).then(res, rej);
  b.catch  = (fn: (e: unknown) => unknown) => Promise.resolve(arrayResult).catch(fn);
  b.finally = (fn: () => void) => Promise.resolve(arrayResult).finally(fn);
  return b;
}

function makeRequest() {
  return new NextRequest("http://localhost/api/leaderboard");
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const dbUserRows = [
  {
    id: "alice", handle: "alice", display_name: "Alice A",
    avatar_color: "bg-orange-500", profile_picture_url: null,
    points: 250, total_ticks: 12,
  },
  {
    id: "bob", handle: "bob", display_name: "Bob B",
    avatar_color: "bg-blue-500", profile_picture_url: "https://example.com/bob.jpg",
    points: 100, total_ticks: 5,
  },
];

const dbHardestRows = [
  {
    user_id: "alice", id: "tick-a1", date: new Date("2026-03-01T10:00:00Z"),
    attempts: 2, climb_id: "c-a1", climb_name: "Cobra Crack",
    grade: "V8", angle: 40, board_name: "Kilter Board", rn: 1,
  },
  {
    user_id: "alice", id: "tick-a2", date: new Date("2026-02-15T10:00:00Z"),
    attempts: 5, climb_id: "c-a2", climb_name: "Cobra Crack",
    grade: "V8", angle: 40, board_name: "Kilter Board", rn: 2,
  },
  {
    user_id: "bob", id: "tick-b1", date: new Date("2026-03-10T10:00:00Z"),
    attempts: 1, climb_id: "c-b1", climb_name: "Easy Street",
    grade: "V4", angle: 30, board_name: "Moonboard 2016", rn: 1,
  },
];

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // db.raw calls in order: COUNT(*) fragment, COALESCE fragment, then the CTE (async)
  (db as unknown as Record<string, unknown>).raw = jest.fn()
    .mockReturnValueOnce("__cnt__")
    .mockReturnValueOnce("__coalesce__")
    .mockResolvedValueOnce({ rows: dbHardestRows });
});

function setupHappyPath(userRows = dbUserRows, hardestRows = dbHardestRows) {
  (db as unknown as Record<string, unknown>).raw = jest.fn()
    .mockReturnValueOnce("__cnt__")
    .mockReturnValueOnce("__coalesce__")
    .mockResolvedValueOnce({ rows: hardestRows });
  mockDb
    .mockReturnValueOnce(qb(userRows))  // db("users as u")
    .mockReturnValueOnce(qb());          // db("ticks") subquery inside leftJoin
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/leaderboard", () => {

  it("returns 200 with an array of entries", async () => {
    setupHappyPath();
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("maps DB snake_case columns to camelCase response fields", async () => {
    setupHappyPath();
    const res = await GET(makeRequest());
    const [alice] = await res.json();

    expect(alice.id).toBe("alice");
    expect(alice.handle).toBe("alice");
    expect(alice.displayName).toBe("Alice A");
    expect(alice.avatarColor).toBe("bg-orange-500");
    expect(alice.points).toBe(250);
    expect(alice.totalTicks).toBe(12);
  });

  it("includes profilePictureUrl when present in the DB row", async () => {
    setupHappyPath();
    const res = await GET(makeRequest());
    const entries = await res.json();
    const bob = entries.find((e: { handle: string }) => e.handle === "bob");
    expect(bob.profilePictureUrl).toBe("https://example.com/bob.jpg");
  });

  it("omits profilePictureUrl (undefined) when the DB column is null", async () => {
    setupHappyPath();
    const res = await GET(makeRequest());
    const [alice] = await res.json();
    expect(alice.profilePictureUrl).toBeUndefined();
  });

  it("defaults points to 0 when the DB column is null", async () => {
    const rows = [{ ...dbUserRows[0], points: null }];
    setupHappyPath(rows, []);
    const res = await GET(makeRequest());
    const [entry] = await res.json();
    expect(entry.points).toBe(0);
  });

  it("sets hardestGrade from the CTE result for each user", async () => {
    setupHappyPath();
    const res = await GET(makeRequest());
    const entries = await res.json();
    const alice = entries.find((e: { handle: string }) => e.handle === "alice");
    const bob   = entries.find((e: { handle: string }) => e.handle === "bob");
    expect(alice.hardestGrade).toBe("V8");
    expect(bob.hardestGrade).toBe("V4");
  });

  it("sets hardestGrade to null when the user has no sent ticks", async () => {
    setupHappyPath(dbUserRows, []);  // no CTE rows
    const res = await GET(makeRequest());
    const [alice] = await res.json();
    expect(alice.hardestGrade).toBeNull();
  });

  it("populates hardestGradeTicks with tick data for the hover tooltip", async () => {
    setupHappyPath();
    const res = await GET(makeRequest());
    const [alice] = await res.json();

    expect(alice.hardestGradeTicks).toHaveLength(2);
    expect(alice.hardestGradeTicks[0]).toMatchObject({
      id:        "tick-a1",
      climbId:   "c-a1",
      climbName: "Cobra Crack",
      grade:     "V8",
      boardName: "Kilter Board",
      angle:     40,
      attempts:  2,
    });
  });

  it("serialises Date objects in hardestGradeTicks to ISO strings", async () => {
    setupHappyPath();
    const res = await GET(makeRequest());
    const [alice] = await res.json();
    expect(typeof alice.hardestGradeTicks[0].date).toBe("string");
    expect(alice.hardestGradeTicks[0].date).toContain("2026-03-01");
  });

  it("returns an empty hardestGradeTicks array for users with no sent ticks", async () => {
    setupHappyPath(dbUserRows, []);
    const res = await GET(makeRequest());
    const [alice] = await res.json();
    expect(alice.hardestGradeTicks).toEqual([]);
  });

  it("returns an empty array when there are no users", async () => {
    setupHappyPath([], []);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("returns 500 when the database throws", async () => {
    jest.spyOn(console, "error").mockImplementationOnce(() => {});
    mockDb.mockImplementationOnce(() => { throw new Error("db down"); });
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
