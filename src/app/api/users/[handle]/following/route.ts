/**
 * Following list for a user — who they follow.
 *
 * @module api/users/handle/following
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/server/db";
import { toUser } from "../../route";

/**
 * List all users that the given handle follows, newest first.
 *
 * **Authentication:** Not required — following lists are public.
 *
 * @param _req - Incoming request (unused).
 * @param params - Route params. `handle` is the user whose following list to fetch.
 *
 * @returns Array of user profile objects representing the accounts being followed.
 *
 * @returns `404` if the handle does not exist.
 * @returns `500` on database error.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    const { handle } = await params;
    const target = await db("users").where({ handle }).first();
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const rows = await db("follows")
      .join("users", "follows.following_id", "users.id")
      .where("follows.follower_id", target.id)
      .orderBy("follows.created_at", "desc")
      .select("users.*");

    return NextResponse.json(rows.map(toUser));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
