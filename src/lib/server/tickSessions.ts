/**
 * Shared server-side reads for climbing sessions.
 *
 * Session membership is defined by the session's [started_at, ended_at]
 * window rather than a foreign key on ticks, so the climbs in a session are
 * always read live — edits to a tick's comment or rating show up immediately.
 * Both the session detail endpoint and the header-image generator need that
 * same read, so it lives here rather than in either route.
 *
 * Server-only — never import from client code.
 */

import db from "@/lib/server/db";
import type { UserTick } from "@/lib/types";

/** The tick_sessions columns needed to resolve a session's climbs. */
export interface SessionWindow {
  user_id: string;
  started_at: string | Date;
  ended_at: string | Date;
}

/** Loads the ticks belonging to a session, in the order they were logged. */
export async function loadSessionTicks(session: SessionWindow): Promise<UserTick[]> {
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

  return rows.map((r) => ({
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
}
