/**
 * Individual tick-session endpoint — a session summary plus its climbs.
 *
 * @module api/tick-sessions/id
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/server/db";
import { toSummary } from "../route";

/**
 * Fetch a single climbing session and the climbs logged during it.
 *
 * **Authentication:** Not required — sessions are public (shareable permalink).
 *
 * Session membership is defined by the session's [started_at, ended_at]
 * window: the climbs are the caller's live ticks in that window, so edits to
 * a tick's comment or rating are always reflected here.
 *
 * @param _req - Incoming request (unused).
 * @param params - Route params. `id` is the session slug
 *   (`<handle>-YYYY-MM-DD-<n>`).
 *
 * @returns The session summary plus a `ticks` array (each embedding climb
 *   name, grade, board name, angle, and the tick's own detail).
 *
 * @returns `404` if the session does not exist.
 * @returns `500` on database error.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const session = await db("tick_sessions").where({ id }).first();
    if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const rows = await db("ticks as t")
      .join("climbs as c", "t.climb_id", "c.id")
      .leftJoin("boards as b", "c.board_id", "b.id")
      .where("t.user_id", session.user_id)
      .andWhere("t.date", ">=", session.started_at)
      .andWhere("t.date", "<=", session.ended_at)
      .orderBy("t.date", "asc")
      .orderBy("t.created_at", "asc")
      .select(
        "t.id", "t.date", "t.sent", "t.rating", "t.comment",
        "t.suggested_grade", "t.instagram_url", "t.attempts",
        "t.duration_minutes", "t.created_at",
        "c.id as climb_id", "c.name as climb_name", "c.grade",
        "c.angle", "b.name as board_name",
      );

    const ticks = rows.map((r) => ({
      id:              r.id,
      climbId:         r.climb_id,
      climbName:       r.climb_name,
      grade:           r.grade,
      boardName:       r.board_name ?? "",
      angle:           r.angle ?? 40,
      date:            r.date,
      sent:            r.sent,
      rating:          r.rating,
      comment:         r.comment ?? undefined,
      suggestedGrade:  r.suggested_grade ?? undefined,
      instagramUrl:    r.instagram_url ?? undefined,
      attempts:        r.attempts ?? undefined,
      durationMinutes: r.duration_minutes ?? undefined,
      createdAt:       r.created_at,
    }));

    return NextResponse.json({ ...toSummary(session), ticks });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch session" }, { status: 500 });
  }
}
