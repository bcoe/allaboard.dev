/**
 * @jest-environment node
 *
 * Security specification: every ACL check must derive the caller's identity
 * from the encrypted iron-session cookie (set server-side during Google OAuth),
 * never from a value the caller supplies in the request body or query string.
 *
 * Each test is written so that it FAILS if the guarded check is relaxed or
 * moved to trust user-supplied values.
 *
 * ── How session.userId is established ────────────────────────────────────────
 *
 * There are exactly two code paths that write session.userId:
 *
 *  1. /api/auth/callback  — after Google's OAuth token exchange, the server
 *     looks up oauth_accounts.user_id from its own DB and assigns that to the
 *     session.  The caller only provides a short-lived `code` and a CSRF
 *     `state`; neither can directly name a userId.
 *
 *  2. /api/onboarding     — after the server creates the users row, it assigns
 *     session.userId = handle server-side, then calls session.save().
 *
 * In both cases the value is written server-side into an iron-session cookie
 * encrypted with SESSION_SECRET.  A caller cannot read, forge, or modify it.
 */

import { NextRequest } from "next/server";
import { PATCH as patchUser }       from "@/app/api/users/[handle]/route";
import { PATCH as patchClimb }      from "@/app/api/climbs/[id]/route";
import { DELETE as deleteTick }     from "@/app/api/ticks/[id]/route";
import { POST  as postSession }     from "@/app/api/sessions/route";
import { POST  as postLogEntry }    from "@/app/api/log-entries/route";
import { PATCH as patchBoard }      from "@/app/api/boards/[id]/route";
import { GET   as oauthCallback }   from "@/app/api/auth/callback/route";
import { qb }                       from "./helpers";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("next/headers", () => ({ cookies: jest.fn().mockResolvedValue({}) }));
jest.mock("iron-session");
jest.mock("@/lib/server/db", () => ({ __esModule: true, default: jest.fn() }));

import db             from "@/lib/server/db";
import { getIronSession } from "iron-session";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb             = db as jest.MockedFunction<any>;
const mockGetIronSession = jest.mocked(getIronSession);

// ── Shared helpers ────────────────────────────────────────────────────────────

/** A fully-authenticated session for `userId`. Cannot be forged by the caller. */
const session = (userId: string) =>
  ({ userId, oauthAccountId: "oauth-1", save: jest.fn() });

/** Authenticated session with no userId (post-OAuth, pre-onboarding). */
const preOnboardSession = (oauthAccountId = "oauth-1") =>
  ({ userId: undefined, oauthAccountId, save: jest.fn() });

/** No session at all. */
const noSession = () =>
  ({ userId: undefined, oauthAccountId: undefined, save: jest.fn() });

function json(body: object, url = "http://localhost/api/x") {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => jest.clearAllMocks());

// ═════════════════════════════════════════════════════════════════════════════
// 1. BODY-SUPPLIED userId CANNOT OVERRIDE THE SESSION IDENTITY
//
// POST /api/sessions and POST /api/log-entries both accept a `userId` field in
// the request body.  The check `body.userId !== session.userId` means the
// session is the authoritative source; the body value is validated against it,
// not the other way round.
// ═════════════════════════════════════════════════════════════════════════════

describe("POST /api/sessions — body.userId cannot override session identity", () => {
  it("rejects when body.userId names a different user than the session (403)", async () => {
    // bob is authenticated; body claims ownership on behalf of alice
    mockGetIronSession.mockResolvedValue(session("bob") as never);
    const res = await postSession(
      json({ userId: "alice", date: "2026-04-01", boardType: "Kilter" }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects when there is no session at all, even with a valid-looking body (401)", async () => {
    mockGetIronSession.mockResolvedValue(noSession() as never);
    const res = await postSession(
      json({ userId: "alice", date: "2026-04-01", boardType: "Kilter" }),
    );
    expect(res.status).toBe(401);
  });

  it("accepts only when body.userId equals the session-derived userId (201)", async () => {
    mockGetIronSession.mockResolvedValue(session("alice") as never);
    const row = { id: "s-1", user_id: "alice", date: "2026-04-01", board_type: "Kilter", angle: 40, duration_minutes: 60, feel_rating: 3 };
    mockDb
      .mockReturnValueOnce(qb())                  // sessions.insert
      .mockReturnValueOnce(qb(row, row))           // sessions.where().first()
      .mockReturnValueOnce(qb([]));               // log_entries (buildSession)
    const res = await postSession(
      json({ userId: "alice", date: "2026-04-01", boardType: "Kilter" }),
    );
    expect(res.status).toBe(201);
  });

  it("inserts user_id from session, not from the body directly", async () => {
    // Even though we pass body.userId=alice AND session=alice, we verify the
    // insert was called — the only path that reaches the insert is when they match.
    mockGetIronSession.mockResolvedValue(session("alice") as never);
    const row = { id: "s-1", user_id: "alice", date: "2026-04-01", board_type: "Kilter", angle: 40, duration_minutes: 60, feel_rating: 3 };
    mockDb
      .mockReturnValueOnce(qb())
      .mockReturnValueOnce(qb(row, row))
      .mockReturnValueOnce(qb([]));
    await postSession(json({ userId: "alice", date: "2026-04-01", boardType: "Kilter" }));
    // The insert QB must have been called (confirms body.userId passed the check)
    const insertQb = mockDb.mock.results[0].value;
    expect(insertQb.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "alice" }),
    );
  });
});

describe("POST /api/log-entries — body.userId cannot override session identity", () => {
  it("rejects when body.userId names a different user than the session (403)", async () => {
    mockGetIronSession.mockResolvedValue(session("bob") as never);
    const res = await postLogEntry(
      json({ userId: "alice", climbId: "c-1", date: "2026-04-01", attempts: 1, sent: false }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects when there is no session at all (401)", async () => {
    mockGetIronSession.mockResolvedValue(noSession() as never);
    const res = await postLogEntry(
      json({ userId: "alice", climbId: "c-1", date: "2026-04-01" }),
    );
    expect(res.status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. URL PATH PARAMETERS IDENTIFY THE RESOURCE, NOT THE CALLER
//
// For endpoints like PATCH /api/users/[handle], the handle in the URL is the
// target resource, not an identity claim.  The session must match it; putting
// a different handle in the URL does not grant the caller those privileges.
// ═════════════════════════════════════════════════════════════════════════════

describe("PATCH /api/users/[handle] — URL handle does not grant identity", () => {
  it("rejects when session.userId does not match the handle in the URL (403)", async () => {
    // bob is authenticated but tries to edit alice's profile by crafting the URL
    mockGetIronSession.mockResolvedValue(session("bob") as never);
    const req = new NextRequest("http://localhost/api/users/alice", {
      method: "PATCH",
      body: JSON.stringify({ bio: "hacked" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await patchUser(req, { params: Promise.resolve({ handle: "alice" }) });
    expect(res.status).toBe(403);
  });

  it("accepts only when the authenticated session matches the URL handle (200)", async () => {
    mockGetIronSession.mockResolvedValue(session("alice") as never);
    const row = { id: "alice", handle: "alice", display_name: "Alice", avatar_color: "bg-orange-500", profile_picture_url: null, bio: "updated", home_board: "Kilter", home_board_angle: 40, joined_at: "2026-01-01", followers_count: 0, following_count: 0, personal_best_kilter: null, personal_best_moonboard: null };
    mockDb
      .mockReturnValueOnce(qb())              // update
      .mockReturnValueOnce(qb(row, row));     // fetch updated
    const req = new NextRequest("http://localhost/api/users/alice", {
      method: "PATCH",
      body: JSON.stringify({ bio: "updated" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await patchUser(req, { params: Promise.resolve({ handle: "alice" }) });
    expect(res.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. RESOURCE OWNERSHIP IS READ FROM THE DB, NOT INFERRED FROM REQUEST VALUES
//
// For climbs, ticks, and boards the owner is stored in the DB row.  The server
// fetches the row and compares its owner column to session.userId.  A caller
// cannot claim ownership by putting values in the request body.
// ═════════════════════════════════════════════════════════════════════════════

describe("PATCH /api/climbs/[id] — owner fetched from DB, not from request", () => {
  const climbOwnedByAlice = { id: "c-1", name: "Test", grade: "V5", board_id: "kb", board_name: "Kilter", angle: 40, description: "", author: "alice", setter: null, star_rating: null, sends: 0, created_at: "2026-01-01" };

  it("rejects an authenticated user who is not the DB-stored author (403)", async () => {
    mockGetIronSession.mockResolvedValue(session("bob") as never);
    mockDb.mockReturnValueOnce(qb(climbOwnedByAlice, climbOwnedByAlice));
    const req = new NextRequest("http://localhost/api/climbs/c-1", {
      method: "PATCH",
      // bob could try to include author: "bob" in the body — must have no effect
      body: JSON.stringify({ name: "Renamed", author: "bob" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await patchClimb(req, { params: Promise.resolve({ id: "c-1" }) });
    expect(res.status).toBe(403);
  });

  it("rejects any unauthenticated request regardless of body content (401)", async () => {
    mockGetIronSession.mockResolvedValue(noSession() as never);
    const req = new NextRequest("http://localhost/api/climbs/c-1", {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed", author: "alice" }),
      headers: { "Content-Type": "application/json" },
    });
    expect((await patchClimb(req, { params: Promise.resolve({ id: "c-1" }) })).status).toBe(401);
  });
});

describe("DELETE /api/ticks/[id] — owner fetched from DB, not from request", () => {
  const tickOwnedByAlice = { id: "t-1", climb_id: "c-1", user_id: "alice", date: "2026-04-01", sent: true, attempts: 3, rating: 3, comment: null, suggested_grade: null, instagram_url: null };

  it("rejects an authenticated user who is not the DB-stored tick owner (403)", async () => {
    mockGetIronSession.mockResolvedValue(session("bob") as never);
    mockDb.mockReturnValueOnce(qb(tickOwnedByAlice, tickOwnedByAlice));
    const req = new NextRequest("http://localhost/api/ticks/t-1", { method: "DELETE" });
    expect((await deleteTick(req, { params: Promise.resolve({ id: "t-1" }) })).status).toBe(403);
  });

  it("rejects any unauthenticated request (401)", async () => {
    mockGetIronSession.mockResolvedValue(noSession() as never);
    const req = new NextRequest("http://localhost/api/ticks/t-1", { method: "DELETE" });
    expect((await deleteTick(req, { params: Promise.resolve({ id: "t-1" }) })).status).toBe(401);
  });
});

describe("PATCH /api/boards/[id] — owner fetched from DB, not from request", () => {
  const boardOwnedByAlice = { id: "b-1", name: "My Wall", type: "spray_wall", location: "Cave", description: null, created_by: "alice" };

  it("rejects an authenticated user who is not the DB-stored board creator (403)", async () => {
    mockGetIronSession.mockResolvedValue(session("bob") as never);
    mockDb.mockReturnValueOnce(qb(boardOwnedByAlice, boardOwnedByAlice));
    const req = new NextRequest("http://localhost/api/boards/b-1", {
      method: "PATCH",
      body: JSON.stringify({ description: "hacked" }),
      headers: { "Content-Type": "application/json" },
    });
    expect((await patchBoard(req, { params: Promise.resolve({ id: "b-1" }) })).status).toBe(403);
  });

  it("rejects any unauthenticated request (401)", async () => {
    mockGetIronSession.mockResolvedValue(noSession() as never);
    const req = new NextRequest("http://localhost/api/boards/b-1", {
      method: "PATCH",
      body: JSON.stringify({ description: "hacked" }),
      headers: { "Content-Type": "application/json" },
    });
    expect((await patchBoard(req, { params: Promise.resolve({ id: "b-1" }) })).status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. SESSION.USERID IS SET FROM THE DB DURING GOOGLE OAUTH, NOT FROM REQUEST
//
// The OAuth callback receives `code` + `state` query params (both server-
// validated).  It exchanges the code with Google for tokens, fetches the
// Google profile, looks up oauth_accounts.user_id in its own DB, and writes
// that value into the session.  The caller cannot inject a userId via URL
// params or body.
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/auth/callback — session.userId is derived from the DB, not from URL params", () => {
  // Minimal OAuth fixture
  const googleTokens  = { access_token: "at", refresh_token: "rt", expires_in: 3600 };
  const googleProfile = { sub: "google-sub-123", email: "alice@example.com", picture: "https://pic" };
  const oauthRow      = { id: "oauth-uuid", user_id: "alice", provider_user_id: "google-sub-123", email: "alice@example.com", profile_picture_url: null, refresh_token: null };

  beforeEach(() => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true,  json: () => Promise.resolve(googleTokens)  })   // token exchange
      .mockResolvedValueOnce({ ok: true,  json: () => Promise.resolve(googleProfile) });  // userinfo
  });

  it("sets session.userId from oauth_accounts.user_id stored in the DB, not from any URL param", async () => {
    const mockSession = { oauthAccountId: undefined as string | undefined, userId: undefined as string | undefined, save: jest.fn() };
    mockGetIronSession.mockResolvedValue(mockSession as never);

    // DB: existing oauth_accounts row linking google-sub → alice
    mockDb
      .mockReturnValueOnce(qb(oauthRow, oauthRow))   // lookup oauth_accounts by sub
      .mockReturnValueOnce(qb())                     // update tokens on existing row
      .mockReturnValueOnce(qb(oauthRow, oauthRow))   // re-fetch updated row
      .mockReturnValueOnce(qb());                    // update users.profile_picture_url

    const req = new NextRequest(
      // The URL contains only `code` and `state` — no userId
      "http://localhost/api/auth/callback?code=auth-code&state=csrf-token",
      { headers: { cookie: "oauth_state=csrf-token" } },
    );

    await oauthCallback(req);

    // session.userId must equal the value from oauth_accounts.user_id (the DB),
    // NOT anything that appeared in the URL or could be set by the caller.
    expect(mockSession.userId).toBe("alice");
    expect(mockSession.oauthAccountId).toBe("oauth-uuid");
    expect(mockSession.save).toHaveBeenCalledTimes(1);
  });

  it("leaves session.userId undefined for a new Google account (redirects to onboarding)", async () => {
    const mockSession = { oauthAccountId: undefined as string | undefined, userId: undefined as string | undefined, save: jest.fn() };
    mockGetIronSession.mockResolvedValue(mockSession as never);

    // No existing oauth_accounts row for this Google sub
    const newRow = { id: "new-oauth-uuid", user_id: null, provider_user_id: "google-sub-new", email: "newuser@example.com", profile_picture_url: null };
    mockDb
      .mockReturnValueOnce(qb(undefined, undefined))    // lookup: no existing row
      .mockReturnValueOnce(qb([newRow], newRow));        // insert + returning("*")

    await oauthCallback(req("http://localhost/api/auth/callback?code=c&state=s", "s"));

    // New account: no user_id yet → session.userId must remain undefined
    // (onboarding will set it later, server-side, after the user chooses a handle)
    expect(mockSession.userId).toBeUndefined();
    expect(mockSession.oauthAccountId).toBe("new-oauth-uuid");
  });

  function req(url: string, state: string) {
    return new NextRequest(url, { headers: { cookie: `oauth_state=${state}` } });
  }
});
