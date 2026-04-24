/**
 * @jest-environment node
 *
 * ACL + contract tests for PATCH /api/comments/[id] and DELETE /api/comments/[id].
 *
 * Comments are a protected resource: only comments.user_id may edit or delete
 * a comment.  These tests will FAIL if the ownership check is removed.
 */

import { NextRequest } from "next/server";
import { PATCH, DELETE } from "@/app/api/comments/[id]/route";
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

const commentRow = {
  id: "comment-1",
  tick_id: "tick-1",
  user_id: "alice",
  parent_comment_id: null,
  body: "Original body",
  created_at: "2026-04-23T10:00:00.000Z",
};

const updatedCommentRow = {
  ...commentRow,
  body: "Updated body",
  handle: "alice",
  display_name: "Alice",
  avatar_color: "bg-orange-500",
  profile_picture_url: null,
};

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function patchReq(id: string, body: object = { body: "Updated body" }) {
  return new NextRequest(`http://localhost/api/comments/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function deleteReq(id: string) {
  return new NextRequest(`http://localhost/api/comments/${id}`, { method: "DELETE" });
}

beforeEach(() => jest.clearAllMocks());

// ── PATCH /api/comments/[id] ──────────────────────────────────────────────────

describe("PATCH /api/comments/[id] — access control", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetIronSession.mockResolvedValue(unauthSession() as never);
    expect((await PATCH(patchReq("comment-1"), params("comment-1"))).status).toBe(401);
  });

  it("returns 404 when the comment does not exist", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb.mockReturnValueOnce(qb(undefined, undefined));
    expect((await PATCH(patchReq("comment-1"), params("comment-1"))).status).toBe(404);
  });

  it("returns 403 when authenticated as a user who does not own the comment", async () => {
    mockGetIronSession.mockResolvedValue(authSession("bob") as never);
    mockDb.mockReturnValueOnce(qb(commentRow, commentRow)); // user_id = "alice", not "bob"
    expect((await PATCH(patchReq("comment-1"), params("comment-1"))).status).toBe(403);
  });
});

describe("PATCH /api/comments/[id] — validation", () => {
  beforeEach(() => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
  });

  it("returns 400 when body is empty", async () => {
    mockDb.mockReturnValueOnce(qb(commentRow, commentRow));
    expect((await PATCH(patchReq("comment-1", { body: "" }), params("comment-1"))).status).toBe(400);
  });

  it("returns 400 when body is whitespace-only", async () => {
    mockDb.mockReturnValueOnce(qb(commentRow, commentRow));
    expect((await PATCH(patchReq("comment-1", { body: "   " }), params("comment-1"))).status).toBe(400);
  });
});

describe("PATCH /api/comments/[id] — happy path", () => {
  it("returns 200 with the updated comment when the owner edits", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb
      .mockReturnValueOnce(qb(commentRow, commentRow))                  // fetch
      .mockReturnValueOnce(qb())                                         // update
      .mockReturnValueOnce(qb(updatedCommentRow, updatedCommentRow));    // fetch updated

    const res = await PATCH(patchReq("comment-1", { body: "Updated body" }), params("comment-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).body).toBe("Updated body");
  });
});

// ── DELETE /api/comments/[id] ─────────────────────────────────────────────────

describe("DELETE /api/comments/[id] — access control", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetIronSession.mockResolvedValue(unauthSession() as never);
    expect((await DELETE(deleteReq("comment-1"), params("comment-1"))).status).toBe(401);
  });

  it("returns 404 when the comment does not exist", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb.mockReturnValueOnce(qb(undefined, undefined));
    expect((await DELETE(deleteReq("comment-1"), params("comment-1"))).status).toBe(404);
  });

  it("returns 403 when authenticated as a user who does not own the comment", async () => {
    mockGetIronSession.mockResolvedValue(authSession("bob") as never);
    mockDb.mockReturnValueOnce(qb(commentRow, commentRow)); // user_id = "alice", not "bob"
    expect((await DELETE(deleteReq("comment-1"), params("comment-1"))).status).toBe(403);
  });
});

describe("DELETE /api/comments/[id] — happy path", () => {
  it("returns 204 when the owner deletes their comment", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb
      .mockReturnValueOnce(qb(commentRow, commentRow))  // fetch
      .mockReturnValueOnce(qb());                        // delete

    const res = await DELETE(deleteReq("comment-1"), params("comment-1"));
    expect(res.status).toBe(204);
  });
});
