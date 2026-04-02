/**
 * @jest-environment node
 *
 * ACL + contract tests for POST /api/sessions
 *
 * Sessions are a protected resource: the userId in the request body must match
 * the authenticated session.userId. These tests will FAIL if that check is removed.
 */

import { NextRequest } from "next/server";
import { POST } from "@/app/api/sessions/route";
import { qb, unauthSession, authSession } from "./helpers";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("next/headers", () => ({ cookies: jest.fn().mockResolvedValue({}) }));
jest.mock("iron-session");
jest.mock("uuid", () => ({ v4: () => "fixed-uuid" }));
jest.mock("@/lib/server/db", () => ({ __esModule: true, default: jest.fn() }));

import db from "@/lib/server/db";
import { getIronSession } from "iron-session";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = db as jest.MockedFunction<any>;
const mockGetIronSession = jest.mocked(getIronSession);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const sessionRow = {
  id: "fixed-uuid", user_id: "alice", date: "2026-04-01",
  board_type: "Kilter", angle: 40, duration_minutes: 60, feel_rating: 3,
};

function postReq(body: object) {
  return new NextRequest("http://localhost/api/sessions", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => jest.clearAllMocks());

describe("POST /api/sessions — access control", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetIronSession.mockResolvedValue(unauthSession() as never);
    const res = await POST(postReq({ userId: "alice", date: "2026-04-01", boardType: "Kilter" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when the request userId does not match the session owner", async () => {
    // bob is authenticated but is trying to create a session for alice
    mockGetIronSession.mockResolvedValue(authSession("bob") as never);
    const res = await POST(postReq({ userId: "alice", date: "2026-04-01", boardType: "Kilter" }));
    expect(res.status).toBe(403);
  });

  it("returns 201 with the new session when the authenticated user creates their own session", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb
      .mockReturnValueOnce(qb())                              // sessions.insert
      .mockReturnValueOnce(qb(sessionRow, sessionRow))        // sessions.where({ id }).first()
      .mockReturnValueOnce(qb([]));                           // log_entries for buildSession

    const res = await POST(postReq({ userId: "alice", date: "2026-04-01", boardType: "Kilter" }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toMatchObject({ userId: "alice", date: "2026-04-01", logEntries: [] });
  });
});
