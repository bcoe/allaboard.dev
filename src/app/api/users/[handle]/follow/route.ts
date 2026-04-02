/**
 * Follow / unfollow a user, and check follow status.
 *
 * @module api/users/handle/follow
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/server/db";
import { resolveUserId } from "@/lib/server/resolveUserId";

/**
 * Follow a user.
 *
 * **Authentication:** Required — session cookie or `?token=`.
 * A user cannot follow themselves (`400`).
 *
 * @param req - Incoming request.
 * @param params - Route params. `handle` is the user to follow.
 *
 * @returns `{ "following": true }` on success.
 *
 * @returns `400` if attempting to follow yourself.
 * @returns `401` if not authenticated.
 * @returns `404` if the target handle does not exist.
 * @returns `500` on database error.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    const userId = await resolveUserId(req);
    if (!userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

    const { handle } = await params;
    if (userId === handle) {
      return NextResponse.json({ error: "Cannot follow yourself" }, { status: 400 });
    }

    const target = await db("users").where({ handle }).first();
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db("follows")
      .insert({ follower_id: userId, following_id: target.id })
      .onConflict(["follower_id", "following_id"])
      .ignore();

    await db("users").where({ id: target.id }).increment("followers_count", 1);
    await db("users").where({ id: userId }).increment("following_count", 1);

    return NextResponse.json({ following: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * Unfollow a user.
 *
 * **Authentication:** Required — session cookie or `?token=`.
 * If the caller was not following the target, the request is a no-op.
 *
 * @param req - Incoming request.
 * @param params - Route params. `handle` is the user to unfollow.
 *
 * @returns `{ "following": false }` on success.
 *
 * @returns `401` if not authenticated.
 * @returns `404` if the target handle does not exist.
 * @returns `500` on database error.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    const userId = await resolveUserId(req);
    if (!userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

    const { handle } = await params;

    const target = await db("users").where({ handle }).first();
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const deleted = await db("follows")
      .where({ follower_id: userId, following_id: target.id })
      .delete();

    if (deleted > 0) {
      await db("users").where({ id: target.id }).decrement("followers_count", 1);
      await db("users").where({ id: userId }).decrement("following_count", 1);
    }

    return NextResponse.json({ following: false });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * Check whether the authenticated user follows a given handle.
 *
 * **Authentication:** Optional. Returns `{ following: false }` when
 * unauthenticated rather than a 401.
 *
 * @param req - Incoming request.
 * @param params - Route params. `handle` is the user to check.
 *
 * @returns `{ "following": true | false }`.
 *
 * @returns `500` on database error.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    const userId = await resolveUserId(req);
    if (!userId) return NextResponse.json({ following: false });

    const { handle } = await params;
    const target = await db("users").where({ handle }).first();
    if (!target) return NextResponse.json({ following: false });

    const row = await db("follows")
      .where({ follower_id: userId, following_id: target.id })
      .first();

    return NextResponse.json({ following: !!row });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
