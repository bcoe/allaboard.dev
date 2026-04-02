/**
 * Log entries endpoint — record a climb attempt within a session.
 *
 * @module api/log-entries
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import db from "@/lib/server/db";
import { resolveUserId } from "@/lib/server/resolveUserId";

/**
 * Log a climb attempt, auto-creating a session for the day if needed.
 *
 * **Authentication:** Required — session cookie or `?token=`. The `userId`
 * in the body must match the authenticated caller (`403` otherwise).
 *
 * @param req - Incoming request. JSON body:
 *   - `userId` *(required)* — owner handle; must match the authenticated caller.
 *   - `climbId` *(required)* — UUID of the climb being logged.
 *   - `date` *(required)* — ISO date string (`"YYYY-MM-DD"`).
 *   - `attempts` *(optional, default 1)* — number of attempts.
 *   - `sent` *(optional, default false)* — whether the climb was completed.
 *   - `notes` *(optional)* — free-form text notes.
 *   - `boardType` *(optional)* — used when auto-creating a session.
 *   - `angle` *(optional, default 40)* — used when auto-creating a session.
 *   - `durationMinutes` *(optional, default 60)* — used when auto-creating a session.
 *   - `feelRating` *(optional, default 3)* — used when auto-creating a session.
 *
 * @remarks
 * If no session exists for the given `userId` + `date`, one is created
 * automatically using the supplied session fields. Incrementing
 * `climbs.sends` when `sent` is true happens atomically within this call.
 *
 * @returns The created log entry object with status `201`:
 * ```json
 * {
 *   "id": "uuid",
 *   "sessionId": "uuid",
 *   "climbId": "uuid",
 *   "userId": "alex",
 *   "date": "2026-04-01",
 *   "attempts": 3,
 *   "sent": true,
 *   "notes": "Crux is the second move."
 * }
 * ```
 *
 * @returns `401` if not authenticated.
 * @returns `403` if `userId` does not match the authenticated caller.
 * @returns `500` on database error.
 */
export async function POST(req: NextRequest) {
  try {
    const resolvedId = await resolveUserId(req);
    if (!resolvedId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

    const { userId, climbId, date, attempts, sent, notes, boardType, angle, durationMinutes, feelRating } =
      await req.json() as Record<string, unknown>;

    if (userId !== resolvedId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Find or create a session for this user+date
    let session = await db("sessions").where({ user_id: userId, date }).first();
    if (!session) {
      const sid = uuidv4();
      await db("sessions").insert({
        id: sid, user_id: userId, date, board_type: boardType ?? "Kilter",
        angle: angle ?? 40, duration_minutes: durationMinutes ?? 60, feel_rating: feelRating ?? 3,
      });
      session = await db("sessions").where({ id: sid }).first();
    }

    const id = uuidv4();
    await db("log_entries").insert({
      id, session_id: session.id, climb_id: climbId, user_id: userId,
      date, attempts: attempts ?? 1, sent: sent ?? false, notes: notes ?? null,
    });

    if (sent) {
      await db("climbs").where({ id: climbId }).increment("sends", 1);
    }

    const entry = await db("log_entries").where({ id }).first();
    return NextResponse.json({
      id: entry.id, sessionId: entry.session_id, climbId: entry.climb_id,
      userId: entry.user_id, date: entry.date, attempts: entry.attempts,
      sent: entry.sent, notes: entry.notes ?? undefined,
    }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to log climb" }, { status: 500 });
  }
}
