/**
 * Individual comment — update or delete.
 *
 * @module api/comments/id
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/server/db";
import { resolveUserId } from "@/lib/server/resolveUserId";

/**
 * Update a comment's body.
 *
 * **Authentication:** Required. Only the comment owner may edit it.
 *
 * @param req - JSON body:
 *   - `body` *(required)* — new comment text.
 * @param params - Route params. `id` is the comment UUID.
 *
 * @returns The updated comment.
 *
 * @returns `400` if body is empty.
 * @returns `401` if not authenticated.
 * @returns `403` if not the comment owner.
 * @returns `404` if comment does not exist.
 * @returns `500` on database error.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  try {
    const { id } = await params;
    const comment = await db("comments").where({ id }).first();
    if (!comment) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (comment.user_id !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { body } = await req.json() as { body?: string };
    if (!body?.trim()) return NextResponse.json({ error: "body required" }, { status: 400 });

    await db("comments").where({ id }).update({ body: body.trim() });
    const updated = await db("comments")
      .join("users", "users.id", "comments.user_id")
      .where("comments.id", id)
      .select(
        "comments.id", "comments.tick_id", "comments.user_id",
        "comments.parent_comment_id", "comments.body", "comments.created_at",
        "users.handle", "users.display_name", "users.avatar_color", "users.profile_picture_url",
      )
      .first();

    return NextResponse.json({
      id: updated.id,
      tickId: updated.tick_id,
      userId: updated.user_id,
      userHandle: updated.handle,
      userDisplayName: updated.display_name,
      userAvatarColor: updated.avatar_color,
      userProfilePictureUrl: updated.profile_picture_url ?? undefined,
      parentCommentId: updated.parent_comment_id ?? undefined,
      body: updated.body,
      createdAt: updated.created_at,
      replies: [],
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update comment" }, { status: 500 });
  }
}

/**
 * Delete a comment.
 *
 * **Authentication:** Required. Only the comment owner may delete it.
 *
 * @param req - Incoming request.
 * @param params - Route params. `id` is the comment UUID.
 *
 * @returns `204 No Content` on success.
 *
 * @returns `401` if not authenticated.
 * @returns `403` if not the comment owner.
 * @returns `404` if comment does not exist.
 * @returns `500` on database error.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  try {
    const { id } = await params;
    const comment = await db("comments").where({ id }).first();
    if (!comment) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (comment.user_id !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await db("comments").where({ id }).delete();
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete comment" }, { status: 500 });
  }
}
