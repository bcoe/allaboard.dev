/**
 * Import personal data from the Aurora (Kilter Board) application.
 *
 * @module api/users/handle/import/aurora
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { v4 as uuidv4 } from "uuid";
import db from "@/lib/server/db";
import { resolveUserId } from "@/lib/server/resolveUserId";
import { fontToVGrade } from "@/lib/fontToVGrade";

interface AuroraAscent {
  climb: string;
  angle: number;
  grade: string;
  count?: number;
  stars?: number;
  climbed_at?: string;
  comment?: string;
  [key: string]: unknown;
}

interface AuroraData {
  ascents: AuroraAscent[];
  [key: string]: unknown;
}

/**
 * Import personal climbing data from an Aurora (Kilter Board) JSON export.
 *
 * **Authentication:** Required — must be authenticated as the target `handle`.
 * This is a protected action; users may only import data into their own account.
 *
 * @param req - Incoming request. JSON body must be a raw Aurora export object
 *   containing an `ascents` array. Each ascent may have:
 *   - `climb` *(required)* — climb name.
 *   - `angle` *(required)* — wall angle in degrees.
 *   - `grade` *(required)* — Font-scale grade string (e.g. `"7a"`).
 *   - `count` *(optional)* — number of attempts.
 *   - `stars` *(optional)* — star rating (0–3); mapped to 1–4 internally.
 *   - `climbed_at` *(optional)* — ISO date/timestamp of the ascent.
 *   - `comment` *(optional)* — free-form notes.
 * @param params - Route params. `handle` is the target user's handle.
 *
 * @remarks
 * Grades in Aurora data use the Font scale and are converted to V-scale on import.
 * Ascents whose grade cannot be converted are skipped.
 *
 * Climbs are looked up by `(name, angle, grade, board_id)` against the
 * "Kilter Board (Original)" board. If no matching climb exists a new one is
 * created attributed to the importing user. If a tick for the same
 * `(climb_id, user_id)` pair already exists it is skipped (not overwritten).
 *
 * @returns
 * ```json
 * { "imported": 5, "climbsCreated": 2, "skipped": 1 }
 * ```
 *
 * @returns `400` if the body is missing, not valid JSON, or has no `ascents` array.
 * @returns `401` if not authenticated.
 * @returns `403` if authenticated as a different user than `handle`.
 * @returns `404` if the Kilter Board (Original) board is not found.
 * @returns `500` on database error.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ handle: string }> },
) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const { handle } = await params;
  if (userId !== handle) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: AuroraData;
  try {
    body = await req.json() as AuroraData;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || !Array.isArray(body.ascents)) {
    return NextResponse.json({ error: "Body must contain an 'ascents' array" }, { status: 400 });
  }

  // Look up the Kilter Board (Original) — all Aurora data is for this board.
  const kilterBoard = await db("boards")
    .where({ name: "Kilter Board (Original)" })
    .first();
  if (!kilterBoard) {
    return NextResponse.json({ error: "Kilter Board (Original) not found" }, { status: 404 });
  }

  const boardId = kilterBoard.id as string;
  let imported = 0;
  let climbsCreated = 0;
  const skipDetails = {
    missingName: 0,
    unknownGrade: 0,
    invalidAngle: 0,
    alreadyImported: 0,
  };

  // Log how many ascents we parsed out of the upload before we start importing.
  // If imports fail with ascents_found=0, the problem is parsing the export file
  // — not the climb/tick insertion that follows.
  Sentry.logger.info("Aurora import parsed", {
    ascents_found: body.ascents.length,
  });

  for (const ascent of body.ascents) {
    const climbName = ascent.climb?.trim();
    if (!climbName) { skipDetails.missingName++; continue; }

    const vGrade = fontToVGrade(ascent.grade ?? "");
    if (!vGrade) { skipDetails.unknownGrade++; continue; }

    const angle = Number(ascent.angle ?? 40);
    if (!Number.isFinite(angle)) { skipDetails.invalidAngle++; continue; }

    // Look up or create the climb.
    let climb = await db("climbs")
      .where({ name: climbName, grade: vGrade, board_id: boardId, angle })
      .first();

    if (!climb) {
      const newId = uuidv4();
      await db("climbs").insert({
        id:          newId,
        name:        climbName,
        grade:       vGrade,
        board_id:    boardId,
        angle,
        description: "",
        author:      userId,
        sends:       0,
      });
      climb = await db("climbs").where({ id: newId }).first();
      climbsCreated++;
    }

    // Parse date — fall back to now if missing or invalid.
    let tickDate: Date;
    if (ascent.climbed_at) {
      const parsed = new Date(ascent.climbed_at);
      tickDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    } else {
      tickDate = new Date();
    }

    // Skip if a tick from this user already exists for this climb on the same
    // calendar day (ignoring time of day), so re-running the same export is
    // idempotent.
    const tickDay = tickDate.toISOString().slice(0, 10);
    const existing = await db("ticks")
      .where({ climb_id: climb.id, user_id: userId })
      .whereRaw("DATE(date) = ?", [tickDay])
      .first();
    if (existing) { skipDetails.alreadyImported++; continue; }

    // Map Aurora's 0–3 star rating to our 1–4 scale.
    const rawStars = ascent.stars != null ? Number(ascent.stars) : 0;
    const rating = Math.min(4, Math.max(1, Math.round(rawStars) + 1));

    const now = new Date();
    await db("ticks").insert({
      id:         uuidv4(),
      climb_id:   climb.id,
      user_id:    userId,
      date:       tickDate,
      sent:       true,
      attempts:   ascent.count ?? null,
      rating,
      comment:    ascent.comment?.trim() || null,
      created_at: now,
      updated_at: now,
    });

    imported++;
  }

  const skipped = Object.values(skipDetails).reduce((a, b) => a + b, 0);

  // Log the outcome of each stage so a degenerate result is easy to diagnose:
  // e.g. lots of skipped_unknown_grade points at the Font→V-scale conversion,
  // while lots of skipped_already_imported just means the export was re-run.
  Sentry.logger.info("Aurora import complete", {
    ascents_found: body.ascents.length,
    imported,
    climbs_created: climbsCreated,
    skipped,
    skipped_unknown_grade: skipDetails.unknownGrade,
    skipped_missing_name: skipDetails.missingName,
    skipped_invalid_angle: skipDetails.invalidAngle,
    skipped_already_imported: skipDetails.alreadyImported,
  });

  return NextResponse.json({ imported, climbsCreated, skipped, skipDetails }, { status: 200 });
}
