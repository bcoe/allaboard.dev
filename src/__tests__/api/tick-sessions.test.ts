/**
 * @jest-environment node
 *
 * Contract tests for the tick-sessions read endpoints:
 *   - GET /api/tick-sessions?userId=      (list a user's sessions)
 *   - GET /api/tick-sessions/[id]         (one session + its climbs)
 *
 * Both are public (no auth); these tests pin the request contract and the
 * camelCase response shaping.
 */

import { NextRequest } from "next/server";
import { GET as listGET } from "@/app/api/tick-sessions/route";
import { GET as detailGET } from "@/app/api/tick-sessions/[id]/route";

jest.mock("@/lib/server/db", () => ({ __esModule: true, default: jest.fn() }));

import db from "@/lib/server/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = db as jest.MockedFunction<any>;

/**
 * Minimal chainable + thenable query-builder stub. Self-contained (does not
 * touch the shared helpers) so it can include `.andWhere`, which the detail
 * route uses. Awaiting resolves to `arrayResult`; `.first()` resolves to
 * `firstResult` (defaults to the first array element).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function b(arrayResult: unknown = [], firstResult?: unknown): Record<string, any> {
  const first =
    firstResult !== undefined
      ? firstResult
      : Array.isArray(arrayResult)
      ? (arrayResult as unknown[])[0]
      : arrayResult;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: Record<string, any> = {};
  for (const m of ["where", "andWhere", "join", "leftJoin", "orderBy", "select"]) {
    q[m] = jest.fn().mockReturnThis();
  }
  q.first = jest.fn().mockResolvedValue(first);
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(arrayResult).then(res, rej);
  q.catch = (fn: (e: unknown) => unknown) => Promise.resolve(arrayResult).catch(fn);
  q.finally = (fn: () => void) => Promise.resolve(arrayResult).finally(fn);
  return q;
}

const sessionRow = {
  id: "alice-2026-10-05-2",
  user_id: "alice",
  date: "2026-10-05",
  session_number: 2,
  started_at: "2026-10-05T18:00:00.000Z",
  ended_at: "2026-10-05T19:30:00.000Z",
  tick_count: 3,
  sent_count: 2,
  hardest_grade: "V6",
  total_minutes: 60,
};

const tickRow = {
  id: "tick-1",
  climb_id: "climb-1",
  climb_name: "Crimp Master",
  grade: "V6",
  angle: 40,
  board_name: "Kilter Board (Original)",
  date: "2026-10-05T18:00:00.000Z",
  sent: true,
  rating: 3,
  comment: "sticky feet",
  suggested_grade: null,
  instagram_url: null,
  attempts: 4,
  duration_minutes: 30,
  created_at: "2026-10-05T18:00:00.000Z",
};

beforeEach(() => jest.clearAllMocks());

describe("GET /api/tick-sessions", () => {
  it("returns 400 when userId is missing", async () => {
    const res = await listGET(new NextRequest("http://localhost/api/tick-sessions"));
    expect(res.status).toBe(400);
    expect(mockDb).not.toHaveBeenCalled();
  });

  it("returns the user's sessions in the camelCase shape", async () => {
    mockDb.mockReturnValueOnce(b([sessionRow]));
    const res = await listGET(new NextRequest("http://localhost/api/tick-sessions?userId=alice"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: "alice-2026-10-05-2",
      userId: "alice",
      sessionNumber: 2,
      tickCount: 3,
      sentCount: 2,
      hardestGrade: "V6",
      totalMinutes: 60,
    });
  });

  it("maps a null total_minutes to undefined (no time recorded)", async () => {
    mockDb.mockReturnValueOnce(b([{ ...sessionRow, total_minutes: null, hardest_grade: null }]));
    const res = await listGET(new NextRequest("http://localhost/api/tick-sessions?userId=alice"));
    const body = await res.json();
    expect(body[0].totalMinutes).toBeUndefined();
    expect(body[0].hardestGrade).toBeUndefined();
  });
});

describe("GET /api/tick-sessions/[id]", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it("returns 404 when the session does not exist", async () => {
    mockDb.mockReturnValueOnce(b(undefined, undefined));
    const res = await detailGET(
      new NextRequest("http://localhost/api/tick-sessions/missing"),
      params("missing"),
    );
    expect(res.status).toBe(404);
  });

  it("returns the session summary plus its shaped ticks", async () => {
    mockDb
      .mockReturnValueOnce(b(sessionRow, sessionRow)) // fetch session
      .mockReturnValueOnce(b([tickRow]));             // fetch ticks in window
    const res = await detailGET(
      new NextRequest("http://localhost/api/tick-sessions/alice-2026-10-05-2"),
      params("alice-2026-10-05-2"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: "alice-2026-10-05-2", sessionNumber: 2, hardestGrade: "V6" });
    expect(body.ticks).toHaveLength(1);
    expect(body.ticks[0]).toMatchObject({
      id: "tick-1",
      climbId: "climb-1",
      climbName: "Crimp Master",
      grade: "V6",
      boardName: "Kilter Board (Original)",
      attempts: 4,
      durationMinutes: 30,
      sent: true,
    });
  });
});
