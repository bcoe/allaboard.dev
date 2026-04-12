/**
 * Admin endpoint — recalculate relative difficulty scores for all boards.
 *
 * Uses a per-user Bradley-Terry / Logistic Regression model to derive how hard
 * each board is relative to the others, based on observed attempt counts.
 *
 * @module api/admin/recalculate-board-difficulty
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions, type SessionData } from "@/lib/server/session";
import { recalculateBoardDifficulty } from "@/lib/server/boardDifficulty";

const ADMIN_HANDLE = "bc";

/**
 * Recalculate board relative difficulty scores and persist them to the database.
 *
 * **Authentication:** Required — restricted to the `bc` admin account.
 *
 * @returns JSON with `lines` (detailed calculation log) and `boardScores`
 *   (map of boardId → new relative_difficulty value written to the DB).
 *
 * @returns `401` if not authenticated.
 * @returns `403` if the caller is not the admin account.
 * @returns `500` on internal error.
 */
export async function POST(_req: NextRequest) {
  try {
    const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    if (session.userId !== ADMIN_HANDLE) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await recalculateBoardDifficulty();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[recalculate-board-difficulty]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
