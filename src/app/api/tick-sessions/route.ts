/**
 * Tick-sessions collection endpoint — list a user's climbing sessions.
 *
 * A session is the denormalized grouping of a user's ticks logged within 6
 * hours of each other. Rows are maintained by a database trigger on the ticks
 * table (see the tick_sessions_trigger migration); this endpoint only reads
 * them.
 *
 * @module api/tick-sessions
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/server/db";

/**
 * List all climbing sessions for a user, most recent first.
 *
 * **Authentication:** Not required — sessions are public (shareable).
 *
 * @param req - Incoming request. Required query parameter:
 *   - `userId` *(required)* — the user handle to fetch sessions for.
 *
 * @returns Array of session summary objects (date, session number, tick and
 *   send counts, hardest sent grade, total recorded working minutes).
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

    const rows = await db("tick_sessions")
      .where({ user_id: userId })
      .orderBy("started_at", "desc")
      .select(
        "id", "user_id", "date", "session_number", "started_at", "ended_at",
        "tick_count", "sent_count", "hardest_grade", "total_minutes",
      );

    return NextResponse.json(rows.map(toSummary));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch sessions" }, { status: 500 });
  }
}

/** Maps a tick_sessions row to the camelCase API shape. */
export function toSummary(r: Record<string, unknown>) {
  return {
    id:            r.id,
    userId:        r.user_id,
    date:          r.date,
    sessionNumber: r.session_number,
    startedAt:     r.started_at,
    endedAt:       r.ended_at,
    tickCount:     r.tick_count,
    sentCount:     r.sent_count,
    hardestGrade:  r.hardest_grade ?? undefined,
    totalMinutes:  r.total_minutes ?? undefined,
  };
}
