/**
 * Comments on ticks — list and create.
 *
 * @module api/comments
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import db from "@/lib/server/db";
import { resolveUserId } from "@/lib/server/resolveUserId";

/**
 * List all comments for a tick, ordered oldest-first, with replies nested.
 *
 * **Authentication:** Not required — comments are public.
 *
 * @param req - Query params:
 *   - `tickId` *(required)* — UUID of the tick to fetch comments for.
 *
 * @returns Array of top-level Comment objects, each with a `replies` array.
 *
 * @returns `400` if `tickId` is missing.
 * @returns `500` on database error.
 */
export async function GET(req: NextRequest) {
  const tickId = req.nextUrl.searchParams.get("tickId");
  if (!tickId) return NextResponse.json({ error: "tickId required" }, { status: 400 });

  try {
    const rows = await db("comments")
      .join("users", "users.id", "comments.user_id")
      .where("comments.tick_id", tickId)
      .orderBy("comments.created_at", "asc")
      .select(
        "comments.id",
        "comments.tick_id",
        "comments.user_id",
        "comments.parent_comment_id",
        "comments.body",
        "comments.created_at",
        "users.handle",
        "users.display_name",
        "users.avatar_color",
        "users.profile_picture_url",
      );

    type Row = {
      id: string;
      tick_id: string;
      user_id: string;
      parent_comment_id: string | null;
      body: string;
      created_at: string;
      handle: string;
      display_name: string;
      avatar_color: string;
      profile_picture_url: string | null;
    };

    interface CommentNode {
      id: string;
      tickId: string;
      userId: string;
      userHandle: string;
      userDisplayName: string;
      userAvatarColor: string;
      userProfilePictureUrl?: string;
      parentCommentId?: string;
      body: string;
      createdAt: string;
      replies: CommentNode[];
    }

    const byId = new Map<string, CommentNode>();
    for (const r of rows as Row[]) {
      byId.set(r.id, {
        id: r.id,
        tickId: r.tick_id,
        userId: r.user_id,
        userHandle: r.handle,
        userDisplayName: r.display_name,
        userAvatarColor: r.avatar_color,
        userProfilePictureUrl: r.profile_picture_url ?? undefined,
        parentCommentId: r.parent_comment_id ?? undefined,
        body: r.body,
        createdAt: r.created_at,
        replies: [],
      });
    }

    const topLevel: CommentNode[] = [];
    for (const r of rows as Row[]) {
      const node = byId.get(r.id)!;
      if (r.parent_comment_id) {
        const parent = byId.get(r.parent_comment_id);
        if (parent) parent.replies.push(node);
        else topLevel.push(node);
      } else {
        topLevel.push(node);
      }
    }

    return NextResponse.json(topLevel);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch comments" }, { status: 500 });
  }
}

/**
 * Post a comment on a tick.
 *
 * **Authentication:** Required.
 *
 * @param req - JSON body:
 *   - `tickId` *(required)* — UUID of the tick being commented on.
 *   - `body` *(required)* — comment text.
 *   - `parentCommentId` *(optional)* — UUID of the parent comment when replying.
 *
 * @returns The created Comment object with status `201`.
 *
 * @returns `400` if `tickId` or `body` are missing.
 * @returns `401` if not authenticated.
 * @returns `404` if the tick does not exist.
 * @returns `500` on database error.
 */
export async function POST(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  try {
    const { tickId, body, parentCommentId } = await req.json() as {
      tickId?: string;
      body?: string;
      parentCommentId?: string;
    };

    if (!tickId || !body?.trim()) {
      return NextResponse.json({ error: "tickId and body required" }, { status: 400 });
    }

    const tick = await db("ticks").where({ id: tickId }).first();
    if (!tick) return NextResponse.json({ error: "Tick not found" }, { status: 404 });

    const id = uuidv4();
    await db("comments").insert({
      id,
      tick_id: tickId,
      user_id: userId,
      parent_comment_id: parentCommentId || null,
      body: body.trim(),
    });

    const comment = await db("comments")
      .join("users", "users.id", "comments.user_id")
      .where("comments.id", id)
      .select(
        "comments.id",
        "comments.tick_id",
        "comments.user_id",
        "comments.parent_comment_id",
        "comments.body",
        "comments.created_at",
        "users.handle",
        "users.display_name",
        "users.avatar_color",
        "users.profile_picture_url",
      )
      .first();

    return NextResponse.json({
      id: comment.id,
      tickId: comment.tick_id,
      userId: comment.user_id,
      userHandle: comment.handle,
      userDisplayName: comment.display_name,
      userAvatarColor: comment.avatar_color,
      userProfilePictureUrl: comment.profile_picture_url ?? undefined,
      parentCommentId: comment.parent_comment_id ?? undefined,
      body: comment.body,
      createdAt: comment.created_at,
      replies: [],
    }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create comment" }, { status: 500 });
  }
}
