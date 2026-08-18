/**
 * @jest-environment node
 *
 * The Mountain Project import endpoint.
 *
 * These outdoor ticks become the caller's own **private day notes**, never climbs
 * in the shared directory — so the properties worth pinning are that it is
 * owner-only, that it writes notes rather than climbs, and that re-importing the
 * same file is a no-op rather than a pile of duplicates.
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
import { POST } from "@/app/api/users/[handle]/import/mountain-project/route";
import { unauthSession, authSession } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = db as jest.MockedFunction<any>;
const mockGetIronSession = jest.mocked(getIronSession);

const HEADER =
  'Date,Route,Rating,Notes,URL,Pitches,Location,"Avg Stars","Your Stars",Style,"Lead Style","Route Type","Your Rating",Length,"Rating Code"';

const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");
const route = (date: string, rating: string, leadStyle = "Redpoint", code = 5000) =>
  [date, "A Route", rating, "", "", "1", "", "3", "3", "Lead", leadStyle, "Sport", "", "", String(code)].join(",");

/** Chainable stub; `existing` is what the "already noted" lookup returns. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function qb(existing: unknown[] = []): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: Record<string, any> = {};
  for (const m of ["where", "whereIn", "select"]) q[m] = jest.fn().mockReturnThis();
  q.insert = jest.fn().mockResolvedValue([{}]);
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(existing).then(res, rej);
  return q;
}

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/users/alice/import/mountain-project", {
    method: "POST",
    body: JSON.stringify(body),
  });

const params = { params: Promise.resolve({ handle: "alice" }) };

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.mockReset();
});

describe("access control", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetIronSession.mockResolvedValue(unauthSession() as never);
    expect((await POST(req({ csv: csv(route("2026-05-01", "5.11a")) }), params)).status).toBe(401);
  });

  it("refuses to import into another climber's notes", async () => {
    mockGetIronSession.mockResolvedValue(authSession("bob") as never);

    const res = await POST(req({ csv: csv(route("2026-05-01", "5.11a")) }), params);

    expect(res.status).toBe(403);
    expect(mockDb).not.toHaveBeenCalled();
  });
});

describe("what it writes", () => {
  beforeEach(() => mockGetIronSession.mockResolvedValue(authSession("alice") as never));

  it("writes day notes, never climbs or ticks", async () => {
    // Outdoor rock has no board and no angle; putting it in the climbs directory
    // would pollute what everyone else browses.
    const q = qb();
    mockDb.mockReturnValue(q);

    await POST(req({ csv: csv(route("2026-05-01", "5.11a")) }), params);

    const tables = mockDb.mock.calls.map((c: unknown[]) => c[0]);
    expect(new Set(tables)).toEqual(new Set(["stats_notes"]));
    expect(q.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        user_id: "alice",
        scope: "day",
        period: "2026-05-01",
        category: "outdoor_climbing",
      }),
    ]);
  });

  it("reports what it created", async () => {
    mockDb.mockReturnValue(qb());

    const res = await POST(
      req({
        csv: csv(
          route("2026-05-01", "5.11a"),
          route("2026-05-02", "5.12a", "Fell/Hung", 6600),
        ),
      }),
      params,
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      notesCreated: 2,
      climbingSessions: 2,
      boulderingSessions: 0,
      daysInFile: 2,
      rowsParsed: 2,
    });
  });

  it("skips a day that already carries a note of that category", async () => {
    // Re-importing the same export must add nothing, and must never overwrite a
    // note written by hand.
    const q = qb([{ period_str: "2026-05-01", category: "outdoor_climbing" }]);
    mockDb.mockReturnValue(q);

    const body = await (
      await POST(req({ csv: csv(route("2026-05-01", "5.11a"), route("2026-05-02", "5.11b")) }), params)
    ).json();

    expect(body.notesCreated).toBe(1);
    expect(body.skipped.alreadyNoted).toBe(1);
    expect(q.insert).toHaveBeenCalledWith([
      expect.objectContaining({ period: "2026-05-02" }),
    ]);
  });

  it("writes nothing at all when every day is already noted", async () => {
    const q = qb([{ period_str: "2026-05-01", category: "outdoor_climbing" }]);
    mockDb.mockReturnValue(q);

    const body = await (await POST(req({ csv: csv(route("2026-05-01", "5.11a")) }), params)).json();

    expect(body.notesCreated).toBe(0);
    expect(q.insert).not.toHaveBeenCalled();
  });
});

describe("bad input", () => {
  beforeEach(() => mockGetIronSession.mockResolvedValue(authSession("alice") as never));

  it("rejects an empty body", async () => {
    expect((await POST(req({}), params)).status).toBe(400);
  });

  it("explains itself when the file is not an export", async () => {
    const res = await POST(req({ csv: "some,other,file\n1,2,3\n" }), params);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Mountain Project/);
  });

  it("rejects an implausibly large upload before parsing it", async () => {
    const res = await POST(req({ csv: "x".repeat(6 * 1024 * 1024) }), params);
    expect(res.status).toBe(400);
  });
});
