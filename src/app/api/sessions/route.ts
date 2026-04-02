/**
 * Climbing sessions endpoint — list and create training sessions.
 *
 * @module api/sessions
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import db from "@/lib/server/db";
import { resolveUserId } from "@/lib/server/resolveUserId";

async function buildSession(row: Record<string, unknown>) {
  const logEntries = await db("log_entries").where({ session_id: row.id }).orderBy("date");
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    boardType: row.board_type,
    angle: row.angle,
    durationMinutes: row.duration_minutes,
    feelRating: row.feel_rating,
    logEntries: logEntries.map((l) => ({
      id: l.id, climbId: l.climb_id, userId: l.user_id,
      date: l.date, attempts: l.attempts, sent: l.sent,
      notes: l.notes ?? undefined,
    })),
  };
}

/**
 * List climbing sessions, optionally filtered to a single user.
 *
 * **Authentication:** Not required — sessions are public.
 *
 * @param req - Incoming request. Accepts optional query param:
 *   - `userId` — filter sessions to this user handle.
 *
 * @returns Array of session objects ordered newest first. Each session
 *   embeds its `logEntries` array.
 *
 * @example
 * ```bash
 * # All sessions
 * curl https://allaboard.dev/api/sessions
 *
 * # Sessions for one user
 * curl "https://allaboard.dev/api/sessions?userId=alex"
 * ```
 *
 * @returns `500` on database error.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("userId");
    const query = db("sessions").orderBy("date", "desc");
    if (userId) query.where({ user_id: userId });
    const rows = await query;
    const sessions = await Promise.all(rows.map(buildSession));
    return NextResponse.json(sessions);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch sessions" }, { status: 500 });
  }
}

/**
 * Create a new climbing session.
 *
 * **Authentication:** Required — session cookie or `?token=`. The `userId`
 * in the request body must match the authenticated user (`403` otherwise).
 *
 * @param req - Incoming request. JSON body:
 *   - `userId` *(required)* — owner handle; must match the authenticated caller.
 *   - `date` *(required)* — ISO date string (`"YYYY-MM-DD"`).
 *   - `boardType` *(optional)* — board name string.
 *   - `angle` *(optional, default 40)* — wall angle in degrees.
 *   - `durationMinutes` *(optional, default 60)* — session length.
 *   - `feelRating` *(optional, default 3)* — subjective feel score 1–5.
 *
 * @returns The created session object with status `201`.
 *
 * @returns `401` if not authenticated.
 * @returns `403` if `userId` does not match the authenticated caller.
 * @returns `500` on database error.
 */
export async function POST(req: NextRequest) {
  try {
    const resolvedId = await resolveUserId(req);
    if (!resolvedId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

    const { userId, date, boardType, angle, durationMinutes, feelRating } =
      await req.json() as Record<string, unknown>;

    if (userId !== resolvedId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const id = uuidv4();
    await db("sessions").insert({
      id, user_id: userId, date, board_type: boardType,
      angle: angle ?? 40, duration_minutes: durationMinutes ?? 60, feel_rating: feelRating ?? 3,
    });
    const row = await db("sessions").where({ id }).first();
    return NextResponse.json(await buildSession(row), { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
