/**
 * Ticks collection endpoint — list all ticks for a user.
 *
 * @module api/ticks
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/server/db";

/**
 * List all ticks submitted by a specific user, newest first.
 *
 * **Authentication:** Not required — tick history is public.
 *
 * @param req - Incoming request. Required query parameter:
 *   - `userId` *(required)* — the user handle to fetch ticks for.
 *
 * @returns Array of tick objects, each including embedded climb name,
 *   grade, board name, and angle.
 *
 * @example
 * ```bash
 * curl "https://allaboard.dev/api/ticks?userId=alex"
 * ```
 *
 * @returns `400` if `userId` is not provided.
 * @returns `500` on database error.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const rows = await db("ticks as t")
      .join("climbs as c", "t.climb_id", "c.id")
      .leftJoin("boards as b", "c.board_id", "b.id")
      .where("t.user_id", userId)
      .orderBy("t.date", "desc")
      .orderBy("t.created_at", "desc")
      .select(
        "t.id", "t.date", "t.sent", "t.rating", "t.comment",
        "t.suggested_grade", "t.instagram_url", "t.attempts", "t.created_at",
        "c.id as climb_id", "c.name as climb_name", "c.grade",
        "c.angle", "b.name as board_name",
      );

    return NextResponse.json(rows.map((r) => ({
      id:             r.id,
      climbId:        r.climb_id,
      climbName:      r.climb_name,
      grade:          r.grade,
      boardName:      r.board_name ?? "",
      angle:          r.angle ?? 40,
      date:           r.date,
      sent:           r.sent,
      rating:         r.rating,
      comment:        r.comment ?? undefined,
      suggestedGrade: r.suggested_grade ?? undefined,
      instagramUrl:   r.instagram_url ?? undefined,
      attempts:       r.attempts ?? undefined,
      createdAt:      r.created_at,
    })));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch ticks" }, { status: 500 });
  }
}
