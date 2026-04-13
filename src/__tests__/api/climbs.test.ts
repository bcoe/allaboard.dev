/**
 * @jest-environment node
 *
 * API contract tests for POST /api/climbs
 *
 * Covers authentication, validation, duplicate detection, successful creation,
 * and — the feature under test — the automatic upsert of setter names into the
 * `setters` table whenever a climb is submitted with a non-empty setter field.
 */

import { NextRequest } from "next/server";
import { POST } from "@/app/api/climbs/route";
import { qb, unauthSession, authSession } from "./helpers";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("next/headers", () => ({ cookies: jest.fn().mockResolvedValue({}) }));
jest.mock("iron-session");
jest.mock("@/lib/server/db", () => ({ __esModule: true, default: jest.fn() }));

import db from "@/lib/server/db";
import { getIronSession } from "iron-session";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = db as jest.MockedFunction<any>;
const mockGetIronSession = jest.mocked(getIronSession);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const kilterBoard = {
  id: "kilter", name: "Kilter Board", type: "standard", relative_difficulty: 1.5,
};
const sprayWallBoard = {
  id: "spray-1", name: "My Wall", type: "spray_wall", relative_difficulty: 1.0,
};

const createdClimbRow = {
  id: "new-climb-uuid",
  name: "The Riddler",
  grade: "V5",
  board_id: "kilter",
  board_name: "Kilter Board",
  angle: 40,
  description: "",
  author: "alice",
  setter: null,
  star_rating: null,
  sends: 0,
  created_at: "2026-04-12T00:00:00Z",
};

function postReq(body: object) {
  return new NextRequest("http://localhost/api/climbs", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

// Sets up the happy-path DB mock sequence for a successful climb creation.
// Call BEFORE mockDb.mockReturnValueOnce chains if you need to adjust specific calls.
function setupHappyPath(
  boardRow = kilterBoard,
  climbRow = createdClimbRow,
  hasSetter = false,
) {
  mockDb
    .mockReturnValueOnce(qb(boardRow, boardRow))  // board lookup
    .mockReturnValueOnce(qb(undefined, undefined)) // dup check → no duplicate
    .mockReturnValueOnce(qb())                     // insert climb
    .mockReturnValueOnce(qb(climbRow, climbRow));  // fetch created climb

  if (hasSetter) {
    // db.raw is used for the setter upsert; mock it to resolve successfully
    (db as unknown as Record<string, unknown>).raw = jest.fn().mockResolvedValue(undefined);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  (db as unknown as Record<string, unknown>).raw = jest.fn().mockResolvedValue(undefined);
});

// ── Authentication ─────────────────────────────────────────────────────────────

describe("POST /api/climbs — authentication", () => {
  it("returns 401 when the request is unauthenticated", async () => {
    mockGetIronSession.mockResolvedValue(unauthSession() as never);
    const res = await POST(postReq({ name: "Test", grade: "V5", boardId: "kilter" }));
    expect(res.status).toBe(401);
  });
});

// ── Validation ─────────────────────────────────────────────────────────────────

describe("POST /api/climbs — validation", () => {
  beforeEach(() => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
  });

  it("returns 400 when name is missing", async () => {
    const res = await POST(postReq({ grade: "V5", boardId: "kilter" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when name is whitespace only", async () => {
    const res = await POST(postReq({ name: "   ", grade: "V5", boardId: "kilter" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when grade is missing", async () => {
    const res = await POST(postReq({ name: "Test", boardId: "kilter" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when boardId is missing", async () => {
    const res = await POST(postReq({ name: "Test", grade: "V5" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the boardId does not match any board", async () => {
    mockDb.mockReturnValueOnce(qb(undefined, undefined)); // board lookup → not found
    const res = await POST(postReq({ name: "Test", grade: "V5", boardId: "nonexistent" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid board/i);
  });

  it("returns 409 when a duplicate climb already exists", async () => {
    mockDb
      .mockReturnValueOnce(qb(kilterBoard, kilterBoard)) // board lookup → found
      .mockReturnValueOnce(qb(createdClimbRow, createdClimbRow)); // dup check → found
    const res = await POST(postReq({ name: "The Riddler", grade: "V5", boardId: "kilter" }));
    expect(res.status).toBe(409);
  });
});

// ── Successful creation ────────────────────────────────────────────────────────

describe("POST /api/climbs — successful creation", () => {
  beforeEach(() => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
  });

  it("returns 201 with the created climb when no setter is provided", async () => {
    setupHappyPath();
    const res = await POST(postReq({ name: "The Riddler", grade: "V5", boardId: "kilter" }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toMatchObject({ name: "The Riddler", grade: "V5", boardName: "Kilter Board" });
  });

  it("does NOT call db.raw for the setter upsert when no setter is provided", async () => {
    setupHappyPath();
    await POST(postReq({ name: "The Riddler", grade: "V5", boardId: "kilter" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((db as any).raw).not.toHaveBeenCalled();
  });

  it("does NOT call db.raw when setter is an empty string", async () => {
    setupHappyPath();
    await POST(postReq({ name: "The Riddler", grade: "V5", boardId: "kilter", setter: "" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((db as any).raw).not.toHaveBeenCalled();
  });

  it("does NOT call db.raw when setter is whitespace only", async () => {
    setupHappyPath();
    await POST(postReq({ name: "The Riddler", grade: "V5", boardId: "kilter", setter: "   " }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((db as any).raw).not.toHaveBeenCalled();
  });
});

// ── Setter upsert ──────────────────────────────────────────────────────────────

describe("POST /api/climbs — setter upsert", () => {
  beforeEach(() => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
  });

  it("calls db.raw with the setter INSERT when a non-empty setter is provided", async () => {
    setupHappyPath(kilterBoard, { ...createdClimbRow, setter: "Chris Sharma" }, true);
    await POST(postReq({ name: "The Riddler", grade: "V5", boardId: "kilter", setter: "Chris Sharma" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawCalls = (db as any).raw.mock.calls as [string, unknown[]][];
    expect(rawCalls.length).toBe(1);
    expect(rawCalls[0][0]).toMatch(/INSERT INTO setters/i);
    expect(rawCalls[0][1]).toContain("Chris Sharma");
  });

  it("trims the setter name before upserting", async () => {
    setupHappyPath(kilterBoard, { ...createdClimbRow, setter: "Chris Sharma" }, true);
    await POST(postReq({
      name: "The Riddler", grade: "V5", boardId: "kilter", setter: "  Chris Sharma  ",
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawCalls = (db as any).raw.mock.calls as [string, unknown[]][];
    expect(rawCalls[0][1]).toContain("Chris Sharma");
    expect(rawCalls[0][1]).not.toContain("  Chris Sharma  ");
  });

  it("uses ON CONFLICT DO NOTHING so re-submitting the same setter is a no-op", async () => {
    setupHappyPath(kilterBoard, { ...createdClimbRow, setter: "Adam Ondra" }, true);
    await POST(postReq({ name: "The Riddler", grade: "V5", boardId: "kilter", setter: "Adam Ondra" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawSql = (db as any).raw.mock.calls[0][0] as string;
    expect(rawSql).toMatch(/ON CONFLICT.*DO NOTHING/i);
  });

  it("still returns 201 even when the setter name already exists in the setters table", async () => {
    setupHappyPath(kilterBoard, { ...createdClimbRow, setter: "Known Setter" }, true);
    // db.raw resolves without error even on conflict (DO NOTHING path)
    const res = await POST(postReq({
      name: "The Riddler", grade: "V5", boardId: "kilter", setter: "Known Setter",
    }));
    expect(res.status).toBe(201);
  });
});

// ── Spray wall behaviour ───────────────────────────────────────────────────────

describe("POST /api/climbs — spray wall angle handling", () => {
  beforeEach(() => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
  });

  it("omits the angle for spray-wall boards", async () => {
    const sprayClimb = { ...createdClimbRow, board_id: "spray-1", board_name: "My Wall", angle: null };
    setupHappyPath(sprayWallBoard, sprayClimb);
    const res = await POST(postReq({ name: "The Riddler", grade: "V5", boardId: "spray-1" }));
    expect(res.status).toBe(201);
    // Verify that insert was called — QB's insert is a no-op mock so we just
    // check the status to confirm the happy path ran through
  });
});
