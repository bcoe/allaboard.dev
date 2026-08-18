/**
 * Deleting a single stats note.
 *
 * @module api/users/handle/stats-notes/id
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import db from "@/lib/server/db";
import { resolveUserId } from "@/lib/server/resolveUserId";

/**
 * Delete one of the climber's own notes.
 *
 * **Authentication:** Required, and owner-only.
 *
 * The `scope` query parameter is the view the deletion was made from, and it must
 * match the note's own scope. That is the server half of a UI rule: weekly notes
 * are deletable only from the week view and daily notes only from the day view,
 * because the week view *shows* daily notes and a delete button next to a note
 * you are not in a position to edit is an accident waiting to happen. Enforcing
 * it here as well means the rule survives a hand-rolled request.
 *
 * @param req - Incoming request. Query parameter:
 *   - `scope` — `day` or `week`; the granularity currently being viewed.
 * @param params - Route params. `handle` is the climber; `id` is the note.
 *
 * @returns `204` with no body once deleted.
 *
 * @returns `400` if `scope` is missing or not a scope.
 * @returns `401` if not authenticated.
 * @returns `403` if the caller is not the owner.
 * @returns `404` if no such note belongs to this climber.
 * @returns `409` if the note's scope differs from the view it was deleted from.
 * @returns `500` on database error.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ handle: string; id: string }> },
) {
  const { handle, id } = await params;

  const userId = await resolveUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  if (userId !== handle) {
    Sentry.logger.warn("Forbidden stats note access", {
      action: "delete", resource: "stats_note", "note.id": id,
      owner: handle, outcome: "forbidden",
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const scope = req.nextUrl.searchParams.get("scope");
  if (scope !== "day" && scope !== "week") {
    return NextResponse.json({ error: "scope must be 'day' or 'week'" }, { status: 400 });
  }

  try {
    // Scoped to the owner in the same statement rather than fetched then checked:
    // one round trip, and no window in which the id could be re-pointed.
    const note = await db("stats_notes")
      .where({ id, user_id: handle })
      .select("scope")
      .first();

    if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (note.scope !== scope) {
      return NextResponse.json(
        { error: `A ${note.scope} note cannot be deleted from the ${scope} view` },
        { status: 409 },
      );
    }

    await db("stats_notes").where({ id, user_id: handle }).delete();

    Sentry.logger.info("Stats note deleted", {
      action: "delete", resource: "stats_note", "note.id": id,
      "note.scope": note.scope, outcome: "deleted",
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete note" }, { status: 500 });
  }
}
