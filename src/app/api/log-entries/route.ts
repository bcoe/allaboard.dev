import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import db from "@/lib/server/db";
import { sessionOptions, type SessionData } from "@/lib/server/session";

export async function POST(req: NextRequest) {
  try {
    const ironSession = await getIronSession<SessionData>(await cookies(), sessionOptions);
    if (!ironSession.userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

    const { userId, climbId, date, attempts, sent, notes, boardType, angle, durationMinutes, feelRating } =
      await req.json() as Record<string, unknown>;

    if (userId !== ironSession.userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
