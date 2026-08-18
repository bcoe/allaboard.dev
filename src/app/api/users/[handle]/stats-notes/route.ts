/**
 * Stats notes — a climber's private annotations on their own timeline.
 *
 * **The only read-protected resource in allaboard.** Everything else here is
 * publicly viewable; these are not. A note may record how much someone drank last
 * week or how badly they slept, so `GET` is restricted to the author exactly like
 * the mutations are. Anything else would leak the sensitive half of the feature
 * while looking like it followed house style.
 *
 * @module api/users/handle/stats-notes
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import db from "@/lib/server/db";
import { resolveUserId } from "@/lib/server/resolveUserId";
import { noteSchema, type NoteScope, type StatsNote } from "@/lib/statsNotes";

/** Rows returned in one read. A year of daily notes is comfortably inside this. */
const MAX_ROWS = 500;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolves the caller against the page owner.
 *
 * Returns the error response to send, or `null` when the caller *is* the owner.
 * Written as one helper because every method needs the identical check, and a
 * copy that drifts is how a private resource stops being private.
 */
async function requireOwner(req: NextRequest, handle: string) {
  const userId = await resolveUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  if (userId !== handle) {
    // Permission event: someone tried to read or write another climber's notes.
    Sentry.logger.warn("Forbidden stats note access", {
      action: req.method?.toLowerCase(), resource: "stats_note",
      owner: handle, outcome: "forbidden",
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/** Shapes a row for the client. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toNote(row: any): StatsNote {
  return {
    id: row.id,
    scope: row.scope,
    // A `date` column comes back as a Date; the client keys periods by string.
    period: row.period_str,
    category: row.category,
    data: row.data ?? {},
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * List the climber's own notes.
 *
 * **Authentication:** Required, **and owner-only** — including for reading. These
 * notes are private.
 *
 * @param req - Incoming request. Query parameters:
 *   - `from` — start of the period range, inclusive (YYYY-MM-DD). Optional.
 *   - `to` — end of the period range, inclusive (YYYY-MM-DD). Optional.
 *   - `scope` — `day` or `week`. Optional; omit to get both, which is what the
 *     week view needs so it can show weekly and daily notes in one card.
 * @param params - Route params. `handle` is the climber whose page this is.
 *
 * @returns `{ notes: StatsNote[] }`, oldest period first.
 *
 * @returns `401` if not authenticated.
 * @returns `403` if the caller is not the climber whose notes these are.
 * @returns `500` on database error.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  const denied = await requireOwner(req, handle);
  if (denied) return denied;

  try {
    const { searchParams } = req.nextUrl;
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const scope = searchParams.get("scope");

    const rows = await db("stats_notes")
      .where({ user_id: handle })
      .modify((q) => {
        if (scope === "day" || scope === "week") q.where({ scope });
        if (from && ISO_DATE.test(from)) q.andWhere("period", ">=", from);
        if (to && ISO_DATE.test(to)) q.andWhere("period", "<=", to);
      })
      .orderBy("period", "asc")
      .orderBy("created_at", "asc")
      .limit(MAX_ROWS)
      .select(
        "id", "scope", "category", "data", "created_at",
        // Formatted in the database, so a period never shifts a day through a
        // client-side UTC conversion — the same trap the session tools hit.
        db.raw("to_char(period, 'YYYY-MM-DD') as period_str"),
      );

    return NextResponse.json(
      { notes: rows.map(toNote) },
      // Private data: never let a shared cache hold it.
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to read notes" }, { status: 500 });
  }
}

/**
 * Attach a note to one of the climber's own days or weeks.
 *
 * **Authentication:** Required, and owner-only.
 *
 * @param req - Incoming request. Body: `{ scope, period, category, data }`.
 *   `period` is the day, or the **Monday** of the week — the database rejects a
 *   week note filed against any other weekday, so one week has one key.
 *   `data` is validated against the category's schema *for that scope*: the
 *   dietary and sleep categories have different option lists on a day and on a
 *   week, and a weekly-only observation cannot be filed against a day.
 * @param params - Route params. `handle` is the climber whose page this is.
 *
 * @returns `201` `{ note }` — the stored note.
 *
 * @returns `400` if the scope, period or category payload is invalid.
 * @returns `401` if not authenticated.
 * @returns `403` if the caller is not the owner.
 * @returns `500` on database error.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  const denied = await requireOwner(req, handle);
  if (denied) return denied;

  try {
    const body = (await req.json()) as {
      scope?: string;
      period?: string;
      category?: string;
      data?: unknown;
    };

    if (body.scope !== "day" && body.scope !== "week") {
      return NextResponse.json({ error: "scope must be 'day' or 'week'" }, { status: 400 });
    }
    if (!body.period || !ISO_DATE.test(body.period)) {
      return NextResponse.json({ error: "period must be YYYY-MM-DD" }, { status: 400 });
    }

    const scope: NoteScope = body.scope;
    const parsed = noteSchema(scope).safeParse({ category: body.category, data: body.data ?? {} });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid note", detail: parsed.error.issues.map((i) => i.message).join("; ") },
        { status: 400 },
      );
    }

    const [row] = await db("stats_notes")
      .insert({
        user_id: handle,
        scope,
        period: body.period,
        category: parsed.data.category,
        data: JSON.stringify(parsed.data.data),
      })
      .returning([
        "id", "scope", "category", "data", "created_at",
        db.raw("to_char(period, 'YYYY-MM-DD') as period_str"),
      ]);

    // Audit event: a note now exists. The category is recorded but never the
    // contents — that is the sensitive part, and the whole reason this resource
    // is read-protected.
    Sentry.logger.info("Stats note created", {
      action: "create", resource: "stats_note", "note.id": row.id,
      "note.scope": scope, "note.category": parsed.data.category, outcome: "created",
    });

    return NextResponse.json({ note: toNote(row) }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save note" }, { status: 500 });
  }
}
