import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import db from "@/lib/server/db";
import { sessionOptions, type SessionData } from "@/lib/server/session";

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

export async function POST(req: NextRequest) {
  try {
    const ironSession = await getIronSession<SessionData>(await cookies(), sessionOptions);
    if (!ironSession.userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

    const { userId, date, boardType, angle, durationMinutes, feelRating } =
      await req.json() as Record<string, unknown>;

    if (userId !== ironSession.userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
