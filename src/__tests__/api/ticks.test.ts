/**
 * @jest-environment node
 *
 * ACL + contract tests for PATCH /api/ticks/[id] and DELETE /api/ticks/[id]
 *
 * Ticks are a protected resource: only ticks.user_id may edit or delete a tick.
 * These tests will FAIL if that ownership check is removed.
 */

import { NextRequest } from "next/server";
import { PATCH, DELETE } from "@/app/api/ticks/[id]/route";
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

const tickRow = {
  id: "tick-1", climb_id: "climb-1", user_id: "alice",
  date: "2026-04-01", sent: true, attempts: 3,
  rating: 3, comment: null, suggested_grade: null, instagram_url: null,
};

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function patchReq(id: string, body: object = { rating: 4 }) {
  return new NextRequest(`http://localhost/api/ticks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
function deleteReq(id: string) {
  return new NextRequest(`http://localhost/api/ticks/${id}`, { method: "DELETE" });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Set up the four DB calls that follow a successful tick fetch (recalculate aggregates). */
function mockAggregateRecalc() {
  mockDb
    .mockReturnValueOnce(qb([{ avg: 3.5 }]))             // avg("rating as avg")
    .mockReturnValueOnce(qb([{ count: 5 }]))             // count("id as count")
    .mockReturnValueOnce(qb());                          // climbs.update(star_rating, sends)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => jest.clearAllMocks());

// ── PATCH /api/ticks/[id] ─────────────────────────────────────────────────────

describe("PATCH /api/ticks/[id] — access control", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetIronSession.mockResolvedValue(unauthSession() as never);
    expect((await PATCH(patchReq("tick-1"), params("tick-1"))).status).toBe(401);
  });

  it("returns 403 when authenticated as a user who does not own the tick", async () => {
    mockGetIronSession.mockResolvedValue(authSession("bob") as never);
    mockDb.mockReturnValueOnce(qb(tickRow, tickRow)); // tick.user_id = "alice", not "bob"
    expect((await PATCH(patchReq("tick-1"), params("tick-1"))).status).toBe(403);
  });

  it("returns 404 when the tick does not exist", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb.mockReturnValueOnce(qb(undefined, undefined));
    expect((await PATCH(patchReq("tick-1"), params("tick-1"))).status).toBe(404);
  });

  it("returns 400 when rating is outside 1–4", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb.mockReturnValueOnce(qb(tickRow, tickRow));
    const res = await PATCH(patchReq("tick-1", { rating: 5 }), params("tick-1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/1.4/);
  });

  it("returns 200 with the updated tick when the owner edits", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    const updated = { ...tickRow, rating: 4 };
    mockDb
      .mockReturnValueOnce(qb(tickRow, tickRow))     // fetch tick
      .mockReturnValueOnce(qb());                    // update tick
    mockAggregateRecalc();
    mockDb.mockReturnValueOnce(qb(updated, updated)); // return updated tick

    const res = await PATCH(patchReq("tick-1", { rating: 4 }), params("tick-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).rating).toBe(4);
  });
});

// ── DELETE /api/ticks/[id] ────────────────────────────────────────────────────

describe("DELETE /api/ticks/[id] — access control", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetIronSession.mockResolvedValue(unauthSession() as never);
    expect((await DELETE(deleteReq("tick-1"), params("tick-1"))).status).toBe(401);
  });

  it("returns 403 when authenticated as a user who does not own the tick", async () => {
    mockGetIronSession.mockResolvedValue(authSession("bob") as never);
    mockDb.mockReturnValueOnce(qb(tickRow, tickRow)); // tick.user_id = "alice"
    expect((await DELETE(deleteReq("tick-1"), params("tick-1"))).status).toBe(403);
  });

  it("returns 404 when the tick does not exist", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb.mockReturnValueOnce(qb(undefined, undefined));
    expect((await DELETE(deleteReq("tick-1"), params("tick-1"))).status).toBe(404);
  });

  it("returns 204 and recalculates climb aggregates when the owner deletes", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb
      .mockReturnValueOnce(qb(tickRow, tickRow))  // fetch tick
      .mockReturnValueOnce(qb());                 // delete tick
    mockAggregateRecalc();

    const res = await DELETE(deleteReq("tick-1"), params("tick-1"));
    expect(res.status).toBe(204);

    // Verify aggregates were recalculated and written back to climbs
    const updateCall = mockDb.mock.results
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((r: any) => r.value.update)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .find((u: any) => u.mock.calls.length > 0);
    expect(updateCall).toBeDefined();
    expect(updateCall).toHaveBeenCalledWith(
      expect.objectContaining({ sends: expect.any(Number) }),
    );
  });
});
