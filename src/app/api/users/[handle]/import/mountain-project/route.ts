/**
 * Importing a Mountain Project tick export as outdoor day notes.
 *
 * The ticks deliberately do **not** become climbs. A Mountain Project tick is an
 * outdoor route or boulder on real rock — no board, no angle — and adding those to
 * the climbs directory everyone browses would pollute it. They land as day notes
 * instead: outside context for how someone's climbing is going.
 *
 * @module api/users/handle/import/mountain-project
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import db from "@/lib/server/db";
import { resolveUserId } from "@/lib/server/resolveUserId";
import { buildMountainProjectNotes } from "@/lib/server/importMountainProject";
import { noteSchema } from "@/lib/statsNotes";

/** A few hundred rows of CSV plus a batch insert; well clear of this. */
export const maxDuration = 60;

/** Refuses obviously wrong uploads before parsing megabytes of them. */
const MAX_CSV_BYTES = 5 * 1024 * 1024;

/**
 * Import outdoor sessions from a Mountain Project CSV export.
 *
 * **Authentication:** Required, and owner-only — these become the caller's own
 * private notes.
 *
 * One day becomes at most two notes: an Outdoor Climbing Session for that day's
 * roped climbs and an Outdoor Bouldering Session for its boulders. Grouping rules
 * live in `buildMountainProjectNotes`.
 *
 * **Re-importing is safe and non-destructive.** A day that already carries a note
 * of the category being imported is skipped rather than duplicated or overwritten,
 * so running the same export twice adds nothing and a note written by hand is
 * never clobbered by a later import.
 *
 * @param req - Incoming request. Body: `{ csv: string }` — the export's text, read
 *   from the file in the browser.
 * @param params - Route params. `handle` is the climber importing.
 *
 * @returns `{ notesCreated, climbingSessions, boulderingSessions, daysInFile, rowsParsed, skipped }`.
 *
 * @returns `400` if the body carries no CSV, it is too large, or its header row is
 *   not a Mountain Project export.
 * @returns `401` if not authenticated.
 * @returns `403` if authenticated as a different user than `handle`.
 * @returns `500` on database error.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;

  const userId = await resolveUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  if (userId !== handle) {
    Sentry.logger.warn("Forbidden Mountain Project import", {
      action: "create", resource: "stats_note", owner: handle, outcome: "forbidden",
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { csv } = (await req.json()) as { csv?: string };
    if (typeof csv !== "string" || !csv.trim()) {
      return NextResponse.json({ error: "No CSV provided" }, { status: 400 });
    }
    if (csv.length > MAX_CSV_BYTES) {
      return NextResponse.json({ error: "That file is too large" }, { status: 400 });
    }

    let plan;
    try {
      plan = buildMountainProjectNotes(csv);
    } catch (err) {
      // A wrong file is a user error, not a server one — say what is wrong.
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Could not read that file" },
        { status: 400 },
      );
    }

    Sentry.logger.info("Mountain Project import started", {
      action: "create", resource: "stats_note",
      "import.rows": plan.rowsParsed,
      "import.notes_planned": plan.notes.length,
      "import.skipped.unparsable_date": plan.skipped.unparsableDate,
      "import.skipped.unknown_grade": plan.skipped.unknownGrade,
    });

    // What is already noted on these days, so a re-import adds nothing.
    const periods = [...new Set(plan.notes.map((n) => n.period))];
    const existing = periods.length
      ? await db("stats_notes")
          .where({ user_id: handle, scope: "day" })
          .whereIn("category", ["outdoor_climbing", "outdoor_bouldering"])
          .whereIn("period", periods)
          .select("category", db.raw("to_char(period, 'YYYY-MM-DD') as period_str"))
      : [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const taken = new Set(existing.map((r: any) => `${r.period_str}:${r.category}`));

    const fresh = plan.notes.filter((n) => !taken.has(`${n.period}:${n.category}`));

    // Validated against the very same schema the dialog uses, so an import can
    // never write a note the editor would refuse to display or re-save.
    const rows: Record<string, unknown>[] = [];
    let invalid = 0;
    for (const note of fresh) {
      const parsed = noteSchema("day").safeParse({ category: note.category, data: note.data });
      if (!parsed.success) { invalid++; continue }
      rows.push({
        user_id: handle,
        scope: "day",
        period: note.period,
        category: parsed.data.category,
        data: JSON.stringify(parsed.data.data),
      });
    }

    // One statement: a few hundred rows is a batch, not a loop of round trips.
    if (rows.length) await db("stats_notes").insert(rows);

    const result = {
      notesCreated: rows.length,
      climbingSessions: rows.filter((r) => r.category === "outdoor_climbing").length,
      boulderingSessions: rows.filter((r) => r.category === "outdoor_bouldering").length,
      daysInFile: periods.length,
      rowsParsed: plan.rowsParsed,
      skipped: {
        alreadyNoted: plan.notes.length - fresh.length,
        unparsableDate: plan.skipped.unparsableDate,
        unknownGrade: plan.skipped.unknownGrade,
        invalid,
      },
    };

    // Flat breakdown, so a partial import can be read back without guessing which
    // stage dropped what.
    Sentry.logger.info("Mountain Project import finished", {
      action: "create", resource: "stats_note", outcome: "imported",
      "import.notes_created": result.notesCreated,
      "import.climbing_sessions": result.climbingSessions,
      "import.bouldering_sessions": result.boulderingSessions,
      "import.days": result.daysInFile,
      "import.skipped.already_noted": result.skipped.alreadyNoted,
      "import.skipped.invalid": invalid,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error(err);
    Sentry.captureException(err, { tags: { feature: "import_mountain_project" } });
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
