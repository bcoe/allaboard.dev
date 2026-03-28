import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import db from "../db";

const router = Router();

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
      id: l.id,
      climbId: l.climb_id,
      userId: l.user_id,
      date: l.date,
      attempts: l.attempts,
      sent: l.sent,
      notes: l.notes ?? undefined,
    })),
  };
}

// GET /sessions?userId=<handle>
router.get("/", async (req, res) => {
  try {
    const query = db("sessions").orderBy("date", "desc");
    if (req.query.userId) query.where({ user_id: req.query.userId });
    const rows = await query;
    const sessions = await Promise.all(rows.map(buildSession));
    res.json(sessions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
});

// POST /sessions
router.post("/", async (req, res) => {
  try {
    const { userId, date, boardType, angle, durationMinutes, feelRating } = req.body as Record<string, unknown>;
    const id = uuidv4();
    await db("sessions").insert({
      id, user_id: userId, date, board_type: boardType,
      angle: angle ?? 40, duration_minutes: durationMinutes ?? 60, feel_rating: feelRating ?? 3,
    });
    const row = await db("sessions").where({ id }).first();
    res.status(201).json(await buildSession(row));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create session" });
  }
});

export default router;
