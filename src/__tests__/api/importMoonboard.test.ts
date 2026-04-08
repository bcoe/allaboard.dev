/**
 * @jest-environment node
 *
 * Tests for POST /api/users/[handle]/import/moonboard
 *
 * Covers:
 * - Authentication and authorization (401 / 403)
 * - Bad request bodies (400)
 * - Successful import: ticks and climbs created
 * - Climb deduplication: existing climb reused, not created again
 * - Tick deduplication: re-importing the same export is fully idempotent
 * - Same climb, different day: allowed (not blocked by dedup)
 * - Projects (NumberOfTries === "Project") are skipped
 * - Font-grade conversion: entries with unrecognised grades are skipped
 * - Missing climb name → skipped
 * - Board resolution: existing board reused; unknown board created on the fly
 * - Angle parsed from MoonBoardConfiguration.Description; defaults to 40
 */

import { NextRequest } from "next/server";
import { POST } from "@/app/api/users/[handle]/import/moonboard/route";
import { qb, unauthSession, authSession } from "./helpers";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("next/headers", () => ({ cookies: jest.fn().mockResolvedValue({}) }));
jest.mock("iron-session");
jest.mock("@/lib/server/db", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("uuid", () => ({ v4: jest.fn().mockReturnValue("new-uuid") }));

import db from "@/lib/server/db";
import { getIronSession } from "iron-session";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = db as jest.MockedFunction<any>;
const mockGetIronSession = jest.mocked(getIronSession);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const moonboard2016 = { id: "moonboard-2016-id", name: "MoonBoard 2016" };

const existingClimb = {
  id: "climb-existing",
  name: "Getting Fingers Ready",
  grade: "V4",
  board_id: "moonboard-2016-id",
  angle: 40,
};

// 2026-03-17T00:00:00.000Z — the raw millisecond value in DateClimbed
const DATE_CLIMBED_MS = 1773705600000;

/**
 * Build a single Moonboard logbook record. Top-level keys can be overridden;
 * to override nested Problem fields pass a full Problem object.
 */
function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    Problem: {
      Name: "GETTING FINGERS READY",
      Grade: "6B+",
      UserGrade: "6B+",
      Holdsetup: { Description: "MoonBoard 2016" },
      MoonBoardConfiguration: { Description: "40° MoonBoard" },
      Setter: { Nickname: "Mark Gadomski" },
      UserRating: 4,
    },
    NumberOfTries: "Flashed",
    DateClimbed: `/Date(${DATE_CLIMBED_MS})/`,
    Attempts: 1,
    Comment: "Great climb",
    ...overrides,
  };
}

/** Wrap one or more records into the Moonboard export body shape. */
function makeBody(records: unknown[] = [makeRecord()]) {
  return {
    entries: [
      { id: 639093024000000000, data: { Data: records } },
    ],
  };
}

const params = (handle: string) => ({ params: Promise.resolve({ handle }) });

function makeReq(handle: string, body: unknown) {
  return new NextRequest(
    `http://localhost/api/users/${handle}/import/moonboard`,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    },
  );
}

beforeEach(() => jest.clearAllMocks());

// ── Auth ──────────────────────────────────────────────────────────────────────

describe("POST /api/users/[handle]/import/moonboard — auth", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetIronSession.mockResolvedValue(unauthSession() as never);
    const res = await POST(makeReq("alice", makeBody()), params("alice"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated as a different user", async () => {
    mockGetIronSession.mockResolvedValue(authSession("bob") as never);
    const res = await POST(makeReq("alice", makeBody()), params("alice"));
    expect(res.status).toBe(403);
  });
});

// ── Bad requests ──────────────────────────────────────────────────────────────

describe("POST /api/users/[handle]/import/moonboard — bad requests", () => {
  beforeEach(() => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
  });

  it("returns 400 when body has no entries array", async () => {
    const res = await POST(makeReq("alice", { foo: "bar" }), params("alice"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/entries/);
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest(
      "http://localhost/api/users/alice/import/moonboard",
      { method: "POST", body: "not-json", headers: { "Content-Type": "application/json" } },
    );
    const res = await POST(req, params("alice"));
    expect(res.status).toBe(400);
  });
});

// ── Successful import ─────────────────────────────────────────────────────────

describe("POST /api/users/[handle]/import/moonboard — successful import", () => {
  beforeEach(() => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
  });

  it("creates a new climb and tick when neither exists", async () => {
    const newClimb = { ...existingClimb, id: "new-uuid" };
    mockDb
      .mockReturnValueOnce(qb([moonboard2016]))             // boards select
      .mockReturnValueOnce(qb(undefined, undefined))         // climb lookup → not found
      .mockReturnValueOnce(qb())                             // climb insert
      .mockReturnValueOnce(qb(newClimb, newClimb))           // fetch new climb
      .mockReturnValueOnce(qb(undefined, undefined))         // tick check → none
      .mockReturnValueOnce(qb());                            // tick insert

    const res = await POST(makeReq("alice", makeBody()), params("alice"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.imported).toBe(1);
    expect(json.climbsCreated).toBe(1);
    expect(json.boardsCreated).toBe(0);
    expect(json.skipped).toBe(0);
  });

  it("reuses an existing climb and creates only the tick", async () => {
    mockDb
      .mockReturnValueOnce(qb([moonboard2016]))              // boards select
      .mockReturnValueOnce(qb(existingClimb, existingClimb)) // climb lookup → found
      .mockReturnValueOnce(qb(undefined, undefined))          // tick check → none
      .mockReturnValueOnce(qb());                             // tick insert

    const res = await POST(makeReq("alice", makeBody()), params("alice"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.imported).toBe(1);
    expect(json.climbsCreated).toBe(0);
  });

  it("imports an empty entries array — returns zeros", async () => {
    mockDb.mockReturnValueOnce(qb([moonboard2016])); // boards select
    const res = await POST(makeReq("alice", { entries: [] }), params("alice"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.imported).toBe(0);
    expect(json.climbsCreated).toBe(0);
    expect(json.skipped).toBe(0);
  });
});

// ── Idempotency (dedup fix) ───────────────────────────────────────────────────

describe("POST /api/users/[handle]/import/moonboard — idempotency", () => {
  beforeEach(() => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
  });

  it("skips a tick when one already exists for the same climb and exact date", async () => {
    const existingTick = { id: "tick-1", climb_id: "climb-existing", user_id: "alice" };
    mockDb
      .mockReturnValueOnce(qb([moonboard2016]))              // boards select
      .mockReturnValueOnce(qb(existingClimb, existingClimb)) // climb lookup → found
      .mockReturnValueOnce(qb(existingTick, existingTick));  // tick check → found → skip

    const res = await POST(makeReq("alice", makeBody()), params("alice"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.imported).toBe(0);
    expect(json.skipped).toBe(1);
    expect(json.skipDetails.alreadyImported).toBe(1);
  });

  it("re-importing the same export file is fully idempotent — all ticks skipped", async () => {
    // Simulates running the same Moonboard export a second time after the first import.
    const record2 = makeRecord({ Problem: { ...makeRecord().Problem, Name: "OUCH." } });
    const body = { entries: [{ id: 1, data: { Data: [makeRecord(), record2] } }] };

    mockDb
      .mockReturnValueOnce(qb([moonboard2016]))              // boards select
      // record 1: climb found, tick found → skip
      .mockReturnValueOnce(qb(existingClimb, existingClimb))
      .mockReturnValueOnce(qb({ id: "tick-1" }, { id: "tick-1" }))
      // record 2: climb found, tick found → skip
      .mockReturnValueOnce(qb(existingClimb, existingClimb))
      .mockReturnValueOnce(qb({ id: "tick-2" }, { id: "tick-2" }));

    const res = await POST(makeReq("alice", body), params("alice"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.imported).toBe(0);
    expect(json.skipped).toBe(2);
    expect(json.skipDetails.alreadyImported).toBe(2);
  });

  it("uses the exact DateClimbed timestamp for the tick duplicate check", async () => {
    // The fix replaces DATE(date) SQL with an exact-value .where({ date: tickDate })
    // lookup. This test verifies the DB is called with a Date object carrying the
    // original millisecond value from the DateClimbed field, not a truncated string.
    const existingTick = { id: "tick-1" };
    mockDb
      .mockReturnValueOnce(qb([moonboard2016]))
      .mockReturnValueOnce(qb(existingClimb, existingClimb))
      .mockReturnValueOnce(qb(existingTick, existingTick));

    await POST(makeReq("alice", makeBody()), params("alice"));

    // Third db() call is the ticks lookup; inspect what was passed to .where()
    const ticksQb = mockDb.mock.results[2].value;
    const whereArg = ticksQb.where.mock.calls[0][0] as { date: unknown };
    expect(whereArg.date).toBeInstanceOf(Date);
    expect((whereArg.date as Date).getTime()).toBe(DATE_CLIMBED_MS);
  });

  it("allows the same climb to be ticked on a different day", async () => {
    // A user climbed the same problem two days later — that is a new tick, not a duplicate.
    const laterDateMs = DATE_CLIMBED_MS + 86_400_000; // one day later
    const record = makeRecord({ DateClimbed: `/Date(${laterDateMs})/` });

    mockDb
      .mockReturnValueOnce(qb([moonboard2016]))
      .mockReturnValueOnce(qb(existingClimb, existingClimb)) // climb found
      .mockReturnValueOnce(qb(undefined, undefined))          // tick check → not found for this date
      .mockReturnValueOnce(qb());                             // tick insert

    const res = await POST(makeReq("alice", makeBody([record])), params("alice"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.imported).toBe(1);
    expect(json.skipped).toBe(0);
  });
});

// ── Skip reasons ──────────────────────────────────────────────────────────────

describe("POST /api/users/[handle]/import/moonboard — skip reasons", () => {
  beforeEach(() => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
  });

  it("skips entries where NumberOfTries is 'Project'", async () => {
    mockDb.mockReturnValueOnce(qb([moonboard2016]));
    const res = await POST(makeReq("alice", makeBody([makeRecord({ NumberOfTries: "Project" })])), params("alice"));
    const json = await res.json();
    expect(json.imported).toBe(0);
    expect(json.skipped).toBe(1);
    expect(json.skipDetails.notSent).toBe(1);
  });

  it("skips entries with no problem name", async () => {
    mockDb.mockReturnValueOnce(qb([moonboard2016]));
    const problem = { ...makeRecord().Problem, Name: undefined };
    const res = await POST(makeReq("alice", makeBody([makeRecord({ Problem: problem })])), params("alice"));
    const json = await res.json();
    expect(json.skipped).toBe(1);
    expect(json.skipDetails.missingName).toBe(1);
  });

  it("skips entries with an unrecognised Font grade", async () => {
    mockDb.mockReturnValueOnce(qb([moonboard2016]));
    const problem = { ...makeRecord().Problem, Grade: "not-a-grade", UserGrade: "not-a-grade" };
    const res = await POST(makeReq("alice", makeBody([makeRecord({ Problem: problem })])), params("alice"));
    const json = await res.json();
    expect(json.skipped).toBe(1);
    expect(json.skipDetails.unknownGrade).toBe(1);
  });

  it("accumulates multiple skip reasons independently", async () => {
    mockDb.mockReturnValueOnce(qb([moonboard2016])); // boards select
    // Then: climb + tick check for the one successful record
    mockDb
      .mockReturnValueOnce(qb(existingClimb, existingClimb))
      .mockReturnValueOnce(qb(undefined, undefined))
      .mockReturnValueOnce(qb());

    const records = [
      makeRecord({ NumberOfTries: "Project" }),                           // notSent
      makeRecord({ Problem: { ...makeRecord().Problem, Name: "" } }),    // missingName
      makeRecord({ Problem: { ...makeRecord().Problem, Grade: "??", UserGrade: "??" } }), // unknownGrade
      makeRecord({ Problem: { ...makeRecord().Problem, Name: "OTHER CLIMB" } }), // success
    ];

    const res = await POST(makeReq("alice", makeBody(records)), params("alice"));
    const json = await res.json();
    expect(json.imported).toBe(1);
    expect(json.skipped).toBe(3);
    expect(json.skipDetails.notSent).toBe(1);
    expect(json.skipDetails.missingName).toBe(1);
    expect(json.skipDetails.unknownGrade).toBe(1);
    expect(json.skipDetails.alreadyImported).toBe(0);
  });
});

// ── Board resolution ──────────────────────────────────────────────────────────

describe("POST /api/users/[handle]/import/moonboard — board resolution", () => {
  beforeEach(() => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
  });

  it("creates a new board when it is not in the database", async () => {
    const newClimb = { ...existingClimb, id: "new-uuid" };
    mockDb
      .mockReturnValueOnce(qb([]))                           // boards select → empty
      .mockReturnValueOnce(qb())                             // board insert
      .mockReturnValueOnce(qb(undefined, undefined))          // climb lookup → not found
      .mockReturnValueOnce(qb())                             // climb insert
      .mockReturnValueOnce(qb(newClimb, newClimb))           // fetch new climb
      .mockReturnValueOnce(qb(undefined, undefined))          // tick check → none
      .mockReturnValueOnce(qb());                            // tick insert

    const res = await POST(makeReq("alice", makeBody()), params("alice"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.imported).toBe(1);
    expect(json.boardsCreated).toBe(1);
  });

  it("reuses the same board across multiple records without extra DB calls", async () => {
    // Two records from the same board — the board must only be looked up once (pre-fetched).
    const record2 = makeRecord({ Problem: { ...makeRecord().Problem, Name: "OUCH." } });
    mockDb
      .mockReturnValueOnce(qb([moonboard2016]))              // boards select (once)
      // record 1
      .mockReturnValueOnce(qb(existingClimb, existingClimb))
      .mockReturnValueOnce(qb(undefined, undefined))
      .mockReturnValueOnce(qb())
      // record 2
      .mockReturnValueOnce(qb(existingClimb, existingClimb))
      .mockReturnValueOnce(qb(undefined, undefined))
      .mockReturnValueOnce(qb());

    const res = await POST(makeReq("alice", makeBody([makeRecord(), record2])), params("alice"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.imported).toBe(2);
    expect(json.boardsCreated).toBe(0);
  });
});

// ── Angle parsing ─────────────────────────────────────────────────────────────

describe("POST /api/users/[handle]/import/moonboard — angle parsing", () => {
  beforeEach(() => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
  });

  it("parses angle from MoonBoardConfiguration.Description ('25° MoonBoard' → 25)", async () => {
    const problem = { ...makeRecord().Problem, MoonBoardConfiguration: { Description: "25° MoonBoard" } };
    const climbAt25 = { ...existingClimb, angle: 25 };
    mockDb
      .mockReturnValueOnce(qb([moonboard2016]))
      .mockReturnValueOnce(qb(climbAt25, climbAt25))
      .mockReturnValueOnce(qb(undefined, undefined))
      .mockReturnValueOnce(qb());

    const res = await POST(makeReq("alice", makeBody([makeRecord({ Problem: problem })])), params("alice"));
    expect(res.status).toBe(200);
    expect((await res.json()).imported).toBe(1);
  });

  it("defaults to angle 40 when MoonBoardConfiguration is absent", async () => {
    const problem = { ...makeRecord().Problem, MoonBoardConfiguration: undefined };
    mockDb
      .mockReturnValueOnce(qb([moonboard2016]))
      .mockReturnValueOnce(qb(existingClimb, existingClimb)) // angle: 40
      .mockReturnValueOnce(qb(undefined, undefined))
      .mockReturnValueOnce(qb());

    const res = await POST(makeReq("alice", makeBody([makeRecord({ Problem: problem })])), params("alice"));
    expect(res.status).toBe(200);
    expect((await res.json()).imported).toBe(1);
  });
});
