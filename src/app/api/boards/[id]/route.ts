/**
 * Individual board endpoint — update a board's metadata.
 *
 * @module api/boards/id
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/server/db";
import { resolveUserId } from "@/lib/server/resolveUserId";
import { toBoard } from "../route";

/**
 * Update a board's name, location, or description.
 *
 * **Authentication:** Required — session cookie or `?token=`. Only the
 * user who created the board may edit it (`403` otherwise).
 *
 * @param req - Incoming request. JSON body (all fields optional):
 *   - `name` — new display name.
 *   - `location` — physical location (spray walls only).
 *   - `description` — free-form description.
 * @param params - Route params. `id` is the board slug/id.
 *
 * @returns The updated board object.
 *
 * @returns `400` if no fields are provided.
 * @returns `401` if not authenticated.
 * @returns `403` if the caller did not create the board.
 * @returns `404` if the board does not exist.
 * @returns `500` on database error.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await resolveUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }

    const { id } = await params;
    const board = await db("boards").where({ id }).first();
    if (!board) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (board.created_by !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { name, location, description } =
      await req.json() as { name?: string; location?: string; description?: string };

    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name.trim();
    if (location !== undefined) patch.location = location.trim() || null;
    if (description !== undefined) patch.description = description.trim() || null;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    await db("boards").where({ id }).update(patch);
    const updated = await db("boards").where({ id }).first();
    return NextResponse.json(toBoard(updated));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
