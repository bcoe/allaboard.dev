/**
 * @jest-environment node
 *
 * ACL + contract tests for PATCH /api/boards/[id]
 *
 * Spray walls / custom boards are a protected resource: only boards.created_by
 * may edit a board. These tests will FAIL if that check is removed.
 */

import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/boards/[id]/route";
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

/** A spray wall created by alice */
const boardRow = {
  id: "my-wall", name: "My Wall", type: "spray_wall",
  location: "The Cave", description: null, created_by: "alice",
};

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function patchReq(id: string, body: object = { description: "Updated description" }) {
  return new NextRequest(`http://localhost/api/boards/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => jest.clearAllMocks());

describe("PATCH /api/boards/[id] — access control", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetIronSession.mockResolvedValue(unauthSession() as never);
    expect((await PATCH(patchReq("my-wall"), params("my-wall"))).status).toBe(401);
  });

  it("returns 403 when authenticated as a user who did not create the board", async () => {
    // bob is authenticated, but the board was created by alice
    mockGetIronSession.mockResolvedValue(authSession("bob") as never);
    mockDb.mockReturnValueOnce(qb(boardRow, boardRow)); // board.created_by = "alice"
    expect((await PATCH(patchReq("my-wall"), params("my-wall"))).status).toBe(403);
  });

  it("returns 404 when the board does not exist", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb.mockReturnValueOnce(qb(undefined, undefined));
    expect((await PATCH(patchReq("my-wall"), params("my-wall"))).status).toBe(404);
  });

  it("returns 400 when the request body contains no updatable fields", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb.mockReturnValueOnce(qb(boardRow, boardRow));
    expect((await PATCH(patchReq("my-wall", {}), params("my-wall"))).status).toBe(400);
  });

  it("returns 200 with the updated board when the creator edits their own board", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    const updated = { ...boardRow, description: "Updated description" };
    mockDb
      .mockReturnValueOnce(qb(boardRow, boardRow))   // fetch board (auth check)
      .mockReturnValueOnce(qb())                     // update
      .mockReturnValueOnce(qb(updated, updated));    // fetch updated board

    const res = await PATCH(patchReq("my-wall"), params("my-wall"));
    expect(res.status).toBe(200);
    expect((await res.json()).description).toBe("Updated description");
  });
});
