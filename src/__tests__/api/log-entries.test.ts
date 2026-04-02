/**
 * @jest-environment node
 *
 * ACL + contract tests for POST /api/log-entries
 *
 * Log entries are a protected resource: the userId in the request body must
 * match the authenticated session.userId. These tests will FAIL if removed.
 */

import { NextRequest } from "next/server";
import { POST } from "@/app/api/log-entries/route";
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

const existingSession = { id: "session-1", user_id: "alice", date: "2026-04-01" };
const entryRow = {
  id: "fixed-uuid", session_id: "session-1", climb_id: "climb-1",
  user_id: "alice", date: "2026-04-01", attempts: 3, sent: true, notes: null,
};

function postReq(body: object) {
  return new NextRequest("http://localhost/api/log-entries", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const validBody = {
  userId: "alice", climbId: "climb-1", date: "2026-04-01", attempts: 3, sent: true,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => jest.clearAllMocks());

describe("POST /api/log-entries — access control", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetIronSession.mockResolvedValue(unauthSession() as never);
    expect((await POST(postReq(validBody))).status).toBe(401);
  });

  it("returns 403 when the request userId does not match the session owner", async () => {
    // bob is authenticated but is trying to log a climb as alice
    mockGetIronSession.mockResolvedValue(authSession("bob") as never);
    expect((await POST(postReq(validBody))).status).toBe(403);
  });

  it("returns 201 with the log entry when the owner logs their own climb", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb
      .mockReturnValueOnce(qb(existingSession, existingSession))  // find existing session
      .mockReturnValueOnce(qb())                                  // log_entries.insert
      .mockReturnValueOnce(qb())                                  // climbs.increment (sent=true)
      .mockReturnValueOnce(qb(entryRow, entryRow));               // log_entries.where().first()

    const res = await POST(postReq(validBody));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toMatchObject({
      userId: "alice", climbId: "climb-1", sent: true, attempts: 3,
    });
  });
});
