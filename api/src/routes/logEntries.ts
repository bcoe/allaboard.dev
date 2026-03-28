import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import db from "../db";

const router = Router();

// POST /log-entries  — add a climb log to a session (creates session if needed)
router.post("/", async (req, res) => {
  try {
    const { userId, climbId, date, attempts, sent, notes, boardType, angle, durationMinutes, feelRating } =
      req.body as Record<string, unknown>;

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

    // Increment sends counter on climb if sent
    if (sent) {
      await db("climbs").where({ id: climbId }).increment("sends", 1);
    }

    const entry = await db("log_entries").where({ id }).first();
    res.status(201).json({
      id: entry.id,
      sessionId: entry.session_id,
      climbId: entry.climb_id,
      userId: entry.user_id,
      date: entry.date,
      attempts: entry.attempts,
      sent: entry.sent,
      notes: entry.notes ?? undefined,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to log climb" });
  }
});

export default router;
