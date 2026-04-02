/**
 * @jest-environment node
 *
 * ACL + contract tests for PATCH /api/climbs/[id]
 *
 * Climbs are a protected resource: only the user who submitted the climb
 * (climbs.author) may edit it. These tests will FAIL if that check is removed.
 */

import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/climbs/[id]/route";
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

const climbRow = {
  id: "climb-1", name: "Test Problem", grade: "V5",
  board_id: "kilter-original", board_name: "Kilter Board (Original)",
  angle: 40, description: "", author: "alice",
  setter: null, star_rating: null, sends: 0, created_at: "2026-01-01",
};

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function patchReq(id: string, body: object = { name: "Renamed" }) {
  return new NextRequest(`http://localhost/api/climbs/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => jest.clearAllMocks());

describe("PATCH /api/climbs/[id] — access control", () => {
  it("returns 401 when the request is unauthenticated", async () => {
    mockGetIronSession.mockResolvedValue(unauthSession() as never);
    const res = await PATCH(patchReq("climb-1"), params("climb-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when an authenticated user who is NOT the author tries to edit", async () => {
    // bob is authenticated, but the climb was authored by alice
    mockGetIronSession.mockResolvedValue(authSession("bob") as never);
    mockDb.mockReturnValueOnce(qb(climbRow, climbRow)); // climb lookup → author: "alice"
    const res = await PATCH(patchReq("climb-1"), params("climb-1"));
    expect(res.status).toBe(403);
  });

  it("returns 404 when the climb does not exist", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb.mockReturnValueOnce(qb(undefined, undefined)); // climb not found
    const res = await PATCH(patchReq("climb-1"), params("climb-1"));
    expect(res.status).toBe(404);
  });

  it("returns 200 when the author edits their own climb", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    const updated = { ...climbRow, name: "Renamed" };
    mockDb
      .mockReturnValueOnce(qb(climbRow, climbRow))          // fetch climb (auth check)
      .mockReturnValueOnce(qb())                            // update
      .mockReturnValueOnce(qb(updated, updated))            // fetch updated climb
      .mockReturnValueOnce(qb([]));                         // fetch beta_videos

    const res = await PATCH(patchReq("climb-1"), params("climb-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe("Renamed");
  });
});
