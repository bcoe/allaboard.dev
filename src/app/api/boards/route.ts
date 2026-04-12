/**
 * Boards collection endpoint — list and create climbing boards.
 *
 * @module api/boards
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import db from "@/lib/server/db";
import { sessionOptions, type SessionData } from "@/lib/server/session";

function toBoard(row: Record<string, unknown>) {
  return {
    id:                 row.id,
    name:               row.name,
    type:               row.type ?? "standard",
    relativeDifficulty: Number(row.relative_difficulty ?? 1.0),
    location:           row.location ?? undefined,
    description:        row.description ?? undefined,
    createdBy:          row.created_by ?? undefined,
  };
}

export { toBoard };

/**
 * List all boards, sorted alphabetically by name.
 *
 * **Authentication:** Not required — boards are public.
 *
 * @param req - Incoming request. Optional query parameter:
 *   - `type` — filter to `"standard"` or `"spray_wall"`.
 *
 * @returns Array of board objects.
 *
 * @example
 * ```bash
 * # All boards
 * curl https://allaboard.dev/api/boards
 *
 * # Only spray walls
 * curl "https://allaboard.dev/api/boards?type=spray_wall"
 * ```
 *
 * @returns `500` on database error.
 */
export async function GET(req: NextRequest) {
  try {
    const type = req.nextUrl.searchParams.get("type");
    let query = db("boards").orderBy("name");
    if (type === "standard" || type === "spray_wall") {
      query = query.where({ type });
    }
    const rows = await query;
    return NextResponse.json(rows.map(toBoard));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch boards" }, { status: 500 });
  }
}

/**
 * Create a new board.
 *
 * **Authentication:** Required — session cookie. The authenticated user
 * becomes the `createdBy` owner of the board.
 *
 * @param req - Incoming request. JSON body:
 *   - `name` *(required)* — board display name.
 *   - `type` *(required)* — `"standard"` or `"spray_wall"`.
 *   - `location` *(required for spray walls)* — physical location description.
 *   - `description` *(optional)* — free-form description.
 *
 * @remarks
 * The board `id` is derived as a URL-safe slug from the name. If the slug
 * is already taken, a numeric suffix is appended (e.g. `my-board-2`).
 *
 * @returns The created board object with status `201`.
 *
 * @returns `400` if `name` is missing, `type` is invalid, or `location`
 *   is missing for spray walls.
 * @returns `401` if not authenticated.
 * @returns `500` on database error.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }

    const { name, type, location, description } =
      await req.json() as { name: string; type: string; location?: string; description?: string };

    if (!name?.trim()) {
      return NextResponse.json({ error: "Board name is required" }, { status: 400 });
    }
    if (type !== "standard" && type !== "spray_wall") {
      return NextResponse.json({ error: "Invalid board type" }, { status: 400 });
    }
    if (type === "spray_wall" && !location?.trim()) {
      return NextResponse.json({ error: "Location is required for spray walls" }, { status: 400 });
    }

    // Generate a slug from the name
    const baseSlug = name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    let id = baseSlug;
    let suffix = 1;
    while (await db("boards").where({ id }).first()) {
      id = `${baseSlug}-${suffix++}`;
    }

    await db("boards").insert({
      id,
      name:        name.trim(),
      type,
      location:    location?.trim() || null,
      description: description?.trim() || null,
      created_by:  session.userId,
    });

    const row = await db("boards").where({ id }).first();
    return NextResponse.json(toBoard(row), { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create board" }, { status: 500 });
  }
}
