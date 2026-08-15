/**
 * Individual tick-session endpoint — a session summary plus its climbs.
 *
 * @module api/tick-sessions/id
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/server/db";
import { loadSessionTicks } from "@/lib/server/tickSessions";
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

    const ticks = await loadSessionTicks(session);

    return NextResponse.json({ ...toSummary(session), ticks });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch session" }, { status: 500 });
  }
}
