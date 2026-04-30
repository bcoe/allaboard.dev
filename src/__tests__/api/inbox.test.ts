/**
 * @jest-environment node
 *
 * Contract + ACL tests for GET /api/inbox and PATCH /api/inbox/[id].
 *
 * Inbox items are populated by PostgreSQL triggers (inbox_on_tick_insert and
 * inbox_on_comment_insert) that run at the DB level and cannot be exercised
 * here.  These tests verify that the read / mark-as-read API layer correctly
 * returns and transforms whatever rows the DB contains.
 *
 * Trigger behaviour expectations (require integration tests against real DB):
 *   - tick inserted  → inbox row for every follower of the tick author
 *   - top-level comment inserted → inbox row for the tick owner
 *   - reply inserted → inbox rows for the tick owner + every ancestor author
 *   - no inbox row is ever created for the actor themselves
 *   - duplicate rows are prevented when an ancestor is also the tick owner
 */

import { NextRequest } from "next/server";
import { GET } from "@/app/api/inbox/route";
import { PATCH } from "@/app/api/inbox/[id]/route";
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

const tickInboxRow = {
  id: "inbox-1",
  type: "tick",
  read: false,
  created_at: "2026-04-23T10:00:00.000Z",
  actor_handle: "bob",
  actor_display_name: "Bob",
  actor_avatar_color: "bg-blue-500",
  actor_profile_picture_url: null,
  tick_id: "tick-1",
  tick_sent: true,
  tick_attempts: 3,
  climb_id: "climb-1",
  climb_name: "Problem #1",
  climb_grade: "V8",
  climb_angle: 40,
  board_name: "Kilter Board (Original)",
  comment_id: null,
  comment_body: null,
  comment_tick_id: null,
};

const commentInboxRow = {
  id: "inbox-2",
  type: "comment",
  read: false,
  created_at: "2026-04-23T11:00:00.000Z",
  actor_handle: "charlie",
  actor_display_name: "Charlie",
  actor_avatar_color: "bg-green-500",
  actor_profile_picture_url: null,
  tick_id: "tick-1",
  tick_sent: true,
  tick_attempts: null,
  climb_id: "climb-1",
  climb_name: "Problem #1",
  climb_grade: "V8",
  climb_angle: 40,
  board_name: "Kilter Board (Original)",
  comment_id: "comment-1",
  comment_body: "Great send!",
  comment_tick_id: "tick-1",
};

const readInboxRow = { ...tickInboxRow, id: "inbox-3", read: true };

const inboxItemRow = { id: "inbox-1", user_id: "alice", read: false };

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function patchReq(id: string) {
  return new NextRequest(`http://localhost/api/inbox/${id}`, { method: "PATCH" });
}

beforeEach(() => jest.clearAllMocks());

// ── GET /api/inbox — access control ───────────────────────────────────────────

describe("GET /api/inbox — access control", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetIronSession.mockResolvedValue(unauthSession() as never);
    expect((await GET(new NextRequest("http://localhost/api/inbox"))).status).toBe(401);
  });
});

// ── GET /api/inbox — response shape ───────────────────────────────────────────

describe("GET /api/inbox — tick-type items", () => {
  it("returns items with enriched actor and tick fields", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb.mockReturnValueOnce(qb([tickInboxRow]));

    const { items } = await (await GET(new NextRequest("http://localhost/api/inbox"))).json();
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.type).toBe("tick");
    expect(item.actor).toMatchObject({ handle: "bob", displayName: "Bob" });
    expect(item.tick).toMatchObject({
      id:        "tick-1",
      climbId:   "climb-1",
      climbName: "Problem #1",
      grade:     "V8",
      boardName: "Kilter Board (Original)",
      angle:     40,
      sent:      true,
      attempts:  3,
    });
    expect(item.comment).toBeUndefined();
  });
});

describe("GET /api/inbox — comment-type items", () => {
  it("returns items with enriched actor, tick, and comment fields", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb.mockReturnValueOnce(qb([commentInboxRow]));

    const { items } = await (await GET(new NextRequest("http://localhost/api/inbox"))).json();
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.type).toBe("comment");
    expect(item.actor).toMatchObject({ handle: "charlie" });
    expect(item.comment).toMatchObject({ id: "comment-1", body: "Great send!" });
    expect(item.tick).toMatchObject({ climbName: "Problem #1" });
  });
});

describe("GET /api/inbox — unread count", () => {
  it("includes the total unread count as a separate field", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb.mockReturnValueOnce(qb([tickInboxRow, commentInboxRow]));

    const body = await (await GET(new NextRequest("http://localhost/api/inbox"))).json();
    expect(body.unreadCount).toBe(2);
  });

  it("reports zero when all items are read", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb.mockReturnValueOnce(qb([readInboxRow]));

    const body = await (await GET(new NextRequest("http://localhost/api/inbox"))).json();
    expect(body.unreadCount).toBe(0);
  });

  it("counts only unread items among the fetched rows (mixed read/unread)", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb.mockReturnValueOnce(qb([tickInboxRow, readInboxRow, commentInboxRow]));

    const body = await (await GET(new NextRequest("http://localhost/api/inbox"))).json();
    // tickInboxRow and commentInboxRow are unread; readInboxRow is read
    expect(body.unreadCount).toBe(2);
  });

  it("is bounded by the number of fetched rows, never exceeds 10", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    const tenUnreadRows = Array.from({ length: 10 }, (_, i) => ({
      ...tickInboxRow,
      id: `inbox-${i}`,
      read: false,
    }));
    mockDb.mockReturnValueOnce(qb(tenUnreadRows));

    const body = await (await GET(new NextRequest("http://localhost/api/inbox"))).json();
    expect(body.unreadCount).toBe(10);
    expect(body.items).toHaveLength(10);
  });
});

describe("GET /api/inbox — limit", () => {
  it("passes limit(6) to the query builder", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    const inboxQb = qb([]);
    mockDb.mockReturnValueOnce(inboxQb);

    await GET(new NextRequest("http://localhost/api/inbox"));
    expect(inboxQb.limit).toHaveBeenCalledWith(10);
  });
});

// ── PATCH /api/inbox/[id] ─────────────────────────────────────────────────────

describe("PATCH /api/inbox/[id] — access control", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetIronSession.mockResolvedValue(unauthSession() as never);
    expect((await PATCH(patchReq("inbox-1"), params("inbox-1"))).status).toBe(401);
  });

  it("returns 404 when the inbox item does not exist", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb.mockReturnValueOnce(qb(undefined, undefined));
    expect((await PATCH(patchReq("inbox-1"), params("inbox-1"))).status).toBe(404);
  });

  it("returns 403 when the item belongs to a different user", async () => {
    mockGetIronSession.mockResolvedValue(authSession("bob") as never);
    mockDb.mockReturnValueOnce(qb(inboxItemRow, inboxItemRow)); // user_id = "alice"
    expect((await PATCH(patchReq("inbox-1"), params("inbox-1"))).status).toBe(403);
  });
});

describe("PATCH /api/inbox/[id] — happy path", () => {
  it("returns 200 with { read: true } when the owner marks an item as read", async () => {
    mockGetIronSession.mockResolvedValue(authSession("alice") as never);
    mockDb
      .mockReturnValueOnce(qb(inboxItemRow, inboxItemRow))  // fetch
      .mockReturnValueOnce(qb());                             // update

    const res = await PATCH(patchReq("inbox-1"), params("inbox-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ read: true });
  });
});
