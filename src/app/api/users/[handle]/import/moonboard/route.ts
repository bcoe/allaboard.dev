/**
 * Import personal data from the Moonboard application.
 *
 * @module api/users/handle/import/moonboard
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import db from "@/lib/server/db";
import { resolveUserId } from "@/lib/server/resolveUserId";
import { fontToVGrade } from "@/lib/fontToVGrade";

interface MoonboardSetter {
  Nickname?: string;
  Firstname?: string;
  Lastname?: string;
  [key: string]: unknown;
}

interface MoonboardConfiguration {
  Id?: number;
  /** e.g. "40° MoonBoard" or "20° MoonBoard" */
  Description?: string;
  [key: string]: unknown;
}

interface MoonboardHoldsetup {
  Id?: number;
  /** e.g. "MoonBoard 2016" — maps to a board row by name */
  Description?: string;
  [key: string]: unknown;
}

interface MoonboardProblem {
  Name?: string;
  /** Official Font-scale grade (e.g. "7B+") */
  Grade?: string;
  /** User's personal Font-scale grade opinion */
  UserGrade?: string;
  Setter?: MoonboardSetter;
  MoonBoardConfiguration?: MoonboardConfiguration;
  /** Hold set / board generation — used to resolve the board row */
  Holdsetup?: MoonboardHoldsetup;
  /** User's personal star rating for this problem (Moonboard scale) */
  UserRating?: number;
  [key: string]: unknown;
}

interface MoonboardLogbookEntry {
  Problem?: MoonboardProblem;
  /** Attempt count for this session */
  Attempts?: number;
  /**
   * "Project" when the climb was not sent; a numeric string or number
   * when the problem was completed.
   */
  NumberOfTries?: string | number;
  /** Microsoft JSON date: "/Date(milliseconds)/" */
  DateClimbed?: string;
  /** Human-readable fallback: "21 Mar 2026" */
  DateClimbedAsString?: string;
  Comment?: string | null;
  [key: string]: unknown;
}

interface MoonboardSessionData {
  Data?: MoonboardLogbookEntry[];
  [key: string]: unknown;
}

interface MoonboardEntry {
  id: number;
  data: MoonboardSessionData;
}

interface MoonboardExport {
  logbook?: { Data?: unknown[] };
  entries?: MoonboardEntry[];
  [key: string]: unknown;
}

/** Convert a string to Title Case (e.g. "SIT START" → "Sit Start"). */
function toTitleCase(str: string): string {
  return str
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Extract the wall angle from a MoonBoardConfiguration description string.
 * e.g. "40° MoonBoard" → 40, "20° MoonBoard" → 20.
 * Returns null when the description is absent or unparseable.
 */
function parseAngle(description: unknown): number | null {
  if (typeof description !== "string") return null;
  const match = description.match(/(\d+)°/);
  return match ? Number(match[1]) : null;
}

/**
 * Parse a Moonboard date value, which is in Microsoft JSON Date format:
 *   "/Date(1774051200000)/"
 * Falls back to plain string parsing (e.g. "21 Mar 2026"), then to `null`.
 */
function parseMoonboardDate(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const ms = raw.match(/\/Date\((-?\d+)\)\//);
  if (ms) {
    const d = new Date(Number(ms[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Import personal climbing data from a Moonboard JSON export.
 *
 * The expected input is the JSON file produced by the browser snippet on the
 * user's profile page — `{ logbook, entries }` where each entry contains the
 * response from Moonboard's `GetLogbookEntries` API.
 *
 * **Authentication:** Required — must be authenticated as the target `handle`.
 * This is a protected action; users may only import data into their own account.
 *
 * @param req - Incoming request. JSON body must be the Moonboard export object
 *   with an `entries` array. Each entry's `data.Data` array contains climb records:
 *   - `Problem.Name` *(required)* — climb name.
 *   - `Problem.Grade` *(required)* — Font-scale grade string (e.g. `"7B+"`).
 *   - `Problem.Holdsetup.Description` *(optional)* — board name (e.g. `"MoonBoard 2016"`); looked up or created dynamically.
 *   - `Problem.Setter.Nickname` *(optional)* — setter display name stored on new climbs.
 *   - `Problem.UserRating` *(optional)* — user's star rating; mapped to 1–4 internally.
 *   - `Attempts` *(optional)* — number of attempts for this session.
 *   - `NumberOfTries` *(optional)* — `"Project"` when not sent; a number when completed.
 *   - `DateClimbed` *(optional)* — Microsoft JSON date (`/Date(ms)/`) or plain string.
 *   - `DateClimbedAsString` *(optional)* — human-readable fallback date string.
 *   - `Comment` *(optional)* — free-form notes.
 * @param params - Route params. `handle` is the target user's handle.
 *
 * @remarks
 * Grades use the Font scale and are converted to V-scale on import.
 * Entries whose grade cannot be converted are skipped.
 *
 * The board is resolved per-record from `Problem.Holdsetup.Description` with a
 * case-insensitive name match against existing boards. If no matching board exists
 * it is created on the fly. All boards are fetched once upfront and cached for the
 * duration of the request.
 *
 * The angle is read from each problem's `MoonBoardConfiguration.Description`
 * (e.g. "40° MoonBoard" → 40); falls back to 40 if absent.
 *
 * Climbs are looked up by `(name, angle, grade, board_id)`. If no matching climb
 * exists a new one is created attributed to the importing user. If a tick for the
 * same `(climb_id, user_id)` pair already exists on the same calendar day it is
 * skipped so re-running the same export is idempotent.
 *
 * @returns
 * ```json
 * { "imported": 5, "climbsCreated": 2, "boardsCreated": 0, "skipped": 1 }
 * ```
 *
 * @returns `400` if the body is missing, not valid JSON, or has no `entries` array.
 * @returns `401` if not authenticated.
 * @returns `403` if authenticated as a different user than `handle`.
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

  let body: MoonboardExport;
  try {
    body = await req.json() as MoonboardExport;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || !Array.isArray(body.entries)) {
    return NextResponse.json({ error: "Body must contain an 'entries' array" }, { status: 400 });
  }

  // Optional board-name override supplied by the client (e.g. "Moonboard 2024").
  // When present, every record in this import is attributed to that board rather
  // than relying solely on Problem.Holdsetup.Description from the export data.
  const boardNameOverride = req.nextUrl.searchParams.get("boardName") ?? undefined;

  // Load all existing boards once; cache by lowercase name → id so lookups are O(1).
  const existingBoards = await db("boards").select("id", "name") as { id: string; name: string }[];
  const boardCache = new Map<string, string>(
    existingBoards.map((b) => [b.name.toLowerCase(), b.id]),
  );

  let imported = 0;
  let climbsCreated = 0;
  let boardsCreated = 0;
  const skipDetails = {
    missingName: 0,
    unknownGrade: 0,
    alreadyImported: 0,
    notSent: 0,
  };

  for (const entry of body.entries) {
    const climbRecords = entry?.data?.Data;
    if (!Array.isArray(climbRecords)) continue;

    for (const record of climbRecords) {

      const sent = record.NumberOfTries !== "Project";
      if (!sent) { skipDetails.notSent++; continue; }
      
      const rawName = record.Problem?.Name?.trim();
      if (!rawName) { skipDetails.missingName++; continue; }
      const climbName = toTitleCase(rawName);

      // Grade lives on Problem.Grade (official) — UserGrade is user's opinion.
      const rawGrade = record.Problem?.Grade ?? record.Problem?.UserGrade ?? "";
      const vGrade = fontToVGrade(rawGrade);
      if (!vGrade) { skipDetails.unknownGrade++; continue; }

      // Resolve board: prefer the client-supplied override, then fall back to the
      // per-record Holdsetup.Description, then to "Moonboard 2016".
      const holdsetupName =
        boardNameOverride ??
        (typeof record.Problem?.Holdsetup?.Description === "string" &&
         record.Problem.Holdsetup.Description.trim()
          ? record.Problem.Holdsetup.Description.trim()
          : "Moonboard 2016");
      const boardKey = holdsetupName.toLowerCase();
      let boardId = boardCache.get(boardKey);
      if (!boardId) {
        const newBoardId = uuidv4();
        await db("boards").insert({ id: newBoardId, name: holdsetupName, created_at: new Date() });
        boardCache.set(boardKey, newBoardId);
        boardId = newBoardId;
        boardsCreated++;
      }

      // Angle comes from the problem's configuration description; default to 40.
      const angle = parseAngle(record.Problem?.MoonBoardConfiguration?.Description) ?? 40;

      // "Project" means attempted but not sent — skip those entirely.

      // DateClimbed is a Microsoft JSON date ("/Date(ms)/"). Fall back to the
      // human-readable DateClimbedAsString, then to now.
      const tickDate =
        parseMoonboardDate(record.DateClimbed) ??
        parseMoonboardDate(record.DateClimbedAsString) ??
        new Date();

      // Setter nickname for new climb records.
      const setterNickname =
        typeof record.Problem?.Setter?.Nickname === "string"
          ? record.Problem.Setter.Nickname.trim() || null
          : null;

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
          setter:      setterNickname,
          sends:       0,
        });
        climb = await db("climbs").where({ id: newId }).first();
        climbsCreated++;
      }

      // Skip if a tick from this user already exists for this climb on the same
      // calendar day, so re-running the same export is idempotent.
      const existing = await db("ticks")
        .where({ climb_id: climb.id, user_id: userId, date: tickDate })
        .first();
      if (existing) { skipDetails.alreadyImported++; continue; }

      // Problem.UserRating is the user's personal rating. Map to our 1–4 scale;
      // default to 2 (neutral) when absent or zero.
      const rawRating = Number(record.Problem?.UserRating ?? 0);
      const rating = rawRating > 0 ? Math.min(4, Math.max(1, Math.round(rawRating))) : 2;

      const attempts = typeof record.Attempts === "number" ? record.Attempts : null;

      const now = new Date();
      await db("ticks").insert({
        id:         uuidv4(),
        climb_id:   climb.id,
        user_id:    userId,
        date:       tickDate,
        sent,
        attempts,
        rating,
        comment:    typeof record.Comment === "string" ? record.Comment.trim() || null : null,
        created_at: now,
        updated_at: now,
      });

      imported++;
    }
  }

  const skipped = Object.values(skipDetails).reduce((a, b) => a + b, 0);
  return NextResponse.json({ imported, climbsCreated, boardsCreated, skipped, skipDetails }, { status: 200 });
}
