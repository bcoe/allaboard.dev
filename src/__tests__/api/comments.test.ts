/**
 * @jest-environment node
 *
 * Contract + ACL tests for GET /api/comments and POST /api/comments.
 *
 * NOTE: inbox-notification side-effects (inbox_on_comment_insert trigger) run
 * inside PostgreSQL and cannot be exercised by these unit tests.  They are
 * covered by the integration test suite that runs against a real database.
 */

import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/comments/route";
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

const tickRow = { id: "tick-1", user_id: "alice", climb_id: "climb-1" };

const commentRowA = {
  id: "comment-1",
  tick_id: "tick-1",
  user_id: "alice",
  parent_comment_id: null,
  body: "Nice problem!",
  created_at: "2026-04-23T10:00:00.000Z",
  handle: "alice",
  display_name: "Alice",
  avatar_color: "bg-orange-500",
  profile_picture_url: null,
};

const commentRowB = {
  ...commentRowA,
  id: "comment-2",
  user_id: "bob",
  parent_comment_id: "comment-1",
  body: "Agreed!",
  handle: "bob",
  display_name: "Bob",
};

const commentRowC = {
  ...commentRowA,
  id: "comment-3",
  user_id: "charlie",
  parent_comment_id: "comment-2",
  body: "Same.",
  handle: "charlie",
  display_name: "Charlie",
};

// ── Request helpers ───────────────────────────────────────────────────────────

function getReq(tickId?: string) {
  const url = tickId
    ? `http://localhost/api/comments?tickId=${tickId}`
    : "http://localhost/api/comments";
  return new NextRequest(url);
}

function postReq(body: object) {
  return new NextRequest("http://localhost/api/comments", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => jest.clearAllMocks());

// ── GET /api/comments ─────────────────────────────────────────────────────────

describe("GET /api/comments — validation", () => {
  it("returns 400 when tickId query param is missing", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(400);
  });
});

describe("GET /api/comments — tree shape", () => {
  it("returns an empty array when there are no comments for the tick", async () => {
    mockDb.mockReturnValueOnce(qb([]));
    const res = await GET(getReq("tick-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns a top-level comment with an empty replies array", async () => {
    mockDb.mockReturnValueOnce(qb([commentRowA]));
    const body = await (await GET(getReq("tick-1"))).json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: "comment-1",
      tickId: "tick-1",
      userId: "alice",
      userHandle: "alice",
      body: "Nice problem!",
      replies: [],
    });
    expect(body[0].parentCommentId).toBeUndefined();
  });

  it("nests a direct reply under its parent", async () => {
    mockDb.mockReturnValueOnce(qb([commentRowA, commentRowB]));
    const body = await (await GET(getReq("tick-1"))).json();
    expect(body).toHaveLength(1);
    expect(body[0].replies).toHaveLength(1);
    expect(body[0].replies[0]).toMatchObject({ id: "comment-2", body: "Agreed!" });
  });

  it("nests a reply-to-reply at depth 2 in the correct subtree", async () => {
    mockDb.mockReturnValueOnce(qb([commentRowA, commentRowB, commentRowC]));
    const body = await (await GET(getReq("tick-1"))).json();
    expect(body).toHaveLength(1);
    const [root] = body;
    expect(root.replies).toHaveLength(1);
    expect(root.replies[0].replies).toHaveLength(1);
    expect(root.replies[0].replies[0]).toMatchObject({ id: "comment-3", body: "Same." });
  });

  it("promotes an orphaned reply to top-level when its parent is absent", async () => {
    const orphan = { ...commentRowB, parent_comment_id: "nonexistent" };
    mockDb.mockReturnValueOnce(qb([orphan]));
    const body = await (await GET(getReq("tick-1"))).json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("comment-2");
  });

  it("maps DB column names to camelCase response fields", async () => {
    mockDb.mockReturnValueOnce(qb([commentRowA]));
    const [item] = await (await GET(getReq("tick-1"))).json();
    expect(item).toMatchObject({
      tickId:          "tick-1",
      userId:          "alice",
      userHandle:      "alice",
      userDisplayName: "Alice",
      userAvatarColor: "bg-orange-500",
    });
    expect(item.userProfilePictureUrl).toBeUndefined();
  });
});

// ── POST /api/comments ────────────────────────────────────────────────────────

describe("POST /api/comments — access control", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetIronSession.mockResolvedValue(unauthSession() as never);
    expect((await POST(postReq({ tickId: "tick-1", body: "hi" }))).status).toBe(401);
  });
});

describe("POST /api/comments — validation", () => {
  beforeEach(() => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
  });

  it("returns 400 when tickId is missing", async () => {
    expect((await POST(postReq({ body: "hi" }))).status).toBe(400);
  });

  it("returns 400 when body is missing", async () => {
    expect((await POST(postReq({ tickId: "tick-1" }))).status).toBe(400);
  });

  it("returns 400 when body is whitespace-only", async () => {
    expect((await POST(postReq({ tickId: "tick-1", body: "   " }))).status).toBe(400);
  });

  it("returns 404 when the tick does not exist", async () => {
    mockDb.mockReturnValueOnce(qb(undefined, undefined));
    expect((await POST(postReq({ tickId: "tick-1", body: "hi" }))).status).toBe(404);
  });
});

describe("POST /api/comments — happy path", () => {
  beforeEach(() => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
  });

  it("returns 201 with the created top-level comment", async () => {
    mockDb
      .mockReturnValueOnce(qb(tickRow, tickRow))
      .mockReturnValueOnce(qb())
      .mockReturnValueOnce(qb(commentRowA, commentRowA));

    const res = await POST(postReq({ tickId: "tick-1", body: "Nice problem!" }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toMatchObject({
      id:          "comment-1",
      tickId:      "tick-1",
      userHandle:  "alice",
      body:        "Nice problem!",
      replies:     [],
    });
    expect(data.parentCommentId).toBeUndefined();
  });

  it("returns 201 with parentCommentId set when replying to a comment", async () => {
    const replyRow = { ...commentRowA, id: "comment-2", user_id: "alice", parent_comment_id: "comment-1" };
    mockDb
      .mockReturnValueOnce(qb(tickRow, tickRow))
      .mockReturnValueOnce(qb())
      .mockReturnValueOnce(qb(replyRow, replyRow));

    const res = await POST(postReq({ tickId: "tick-1", body: "Reply!", parentCommentId: "comment-1" }));
    expect(res.status).toBe(201);
    expect((await res.json()).parentCommentId).toBe("comment-1");
  });

  it("returns 201 with parentCommentId set when replying to a deeply-nested comment", async () => {
    const deepReply = { ...commentRowA, id: "comment-4", parent_comment_id: "comment-3" };
    mockDb
      .mockReturnValueOnce(qb(tickRow, tickRow))
      .mockReturnValueOnce(qb())
      .mockReturnValueOnce(qb(deepReply, deepReply));

    const res = await POST(postReq({ tickId: "tick-1", body: "Deep reply", parentCommentId: "comment-3" }));
    expect(res.status).toBe(201);
    expect((await res.json()).parentCommentId).toBe("comment-3");
  });
});
