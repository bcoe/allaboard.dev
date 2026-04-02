/**
 * Climbing statistics endpoint — computed stats for a user.
 *
 * @module api/stats/userId
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import { computeStats } from "@/lib/server/stats";

/**
 * Compute and return climbing statistics for a user.
 *
 * **Authentication:** Not required — stats are public.
 *
 * @param _req - Incoming request (unused).
 * @param params - Route params. `userId` is the user's handle.
 *
 * @remarks
 * Computed stats include:
 * - `gradePyramid` — send counts per V-grade
 * - `sessionFrequency` — sessions per week over time
 * - `progressOverTime` — highest grade sent per session date
 * - `attemptsVsSends` — ratio of attempts to successful sends
 * - `totalSends` — all-time send count
 * - `totalAttempts` — all-time attempt count
 * - `currentStreak` — consecutive days with at least one session
 *
 * @returns A `ClimberStats` object.
 *
 * @returns `500` on database error.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const { userId } = await params;
    const stats = await computeStats(userId);
    return NextResponse.json(stats);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to compute stats" }, { status: 500 });
  }
}
