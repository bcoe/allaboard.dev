/**
 * Inbox — list notification items for the authenticated user.
 *
 * @module api/inbox
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/server/db";
import { resolveUserId } from "@/lib/server/resolveUserId";

/**
 * List the last 25 inbox items for the current user, newest first.
 *
 * Two item types:
 * - `tick` — a followed user ticked a climb.
 * - `comment` — someone commented on one of your ticks.
 *
 * **Authentication:** Required.
 *
 * @returns `{ items: InboxItem[], unreadCount: number }`
 *
 * @returns `401` if not authenticated.
 * @returns `500` on database error.
 */
export async function GET(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  try {
    const rows = await db("inbox_items as ii")
      .join("users as actor", "actor.id", "ii.actor_id")
      .leftJoin("ticks as t", "t.id", "ii.tick_id")
      .leftJoin("climbs as cl", "cl.id", "t.climb_id")
      .leftJoin("boards as b", "b.id", "cl.board_id")
      .leftJoin("comments as cm", "cm.id", "ii.comment_id")
      .where("ii.user_id", userId)
      .orderBy("ii.created_at", "desc")
      .limit(6)
      .select(
        "ii.id",
        "ii.type",
        "ii.read",
        "ii.created_at",
        "actor.handle as actor_handle",
        "actor.display_name as actor_display_name",
        "actor.avatar_color as actor_avatar_color",
        "actor.profile_picture_url as actor_profile_picture_url",
        "t.id as tick_id",
        "t.sent as tick_sent",
        "t.attempts as tick_attempts",
        "cl.id as climb_id",
        "cl.name as climb_name",
        "cl.grade as climb_grade",
        "cl.angle as climb_angle",
        "b.name as board_name",
        "cm.id as comment_id",
        "cm.body as comment_body",
        "cm.tick_id as comment_tick_id",
      );

    const unreadCount = await db("inbox_items")
      .where({ user_id: userId, read: false })
      .count("id as count")
      .first();

    const items = rows.map((r) => ({
      id: r.id,
      type: r.type as "tick" | "comment",
      read: r.read,
      createdAt: r.created_at,
      actor: {
        handle: r.actor_handle,
        displayName: r.actor_display_name,
        avatarColor: r.actor_avatar_color,
        profilePictureUrl: r.actor_profile_picture_url ?? undefined,
      },
      ...(r.tick_id && {
        tick: {
          id: r.tick_id,
          climbId: r.climb_id,
          climbName: r.climb_name,
          grade: r.climb_grade,
          angle: r.climb_angle ?? undefined,
          boardName: r.board_name ?? undefined,
          sent: r.tick_sent,
          attempts: r.tick_attempts ?? undefined,
        },
      }),
      ...(r.comment_id && {
        comment: {
          id: r.comment_id,
          body: r.comment_body,
          tickId: r.comment_tick_id ?? r.tick_id,
        },
      }),
    }));

    return NextResponse.json({
      items,
      unreadCount: Number((unreadCount as { count: string | number } | undefined)?.count ?? 0),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch inbox" }, { status: 500 });
  }
}
