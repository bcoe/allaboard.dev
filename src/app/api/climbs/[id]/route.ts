/**
 * Individual climb endpoint — fetch or update a single climb.
 *
 * @module api/climbs/id
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/server/db";
import { resolveUserId } from "@/lib/server/resolveUserId";

function toClimb(row: Record<string, unknown>, videos: Record<string, unknown>[]) {
  return {
    id:          row.id,
    name:        row.name,
    grade:       row.grade,
    boardId:     row.board_id,
    boardName:   row.board_name ?? null,
    angle:       row.angle ?? 40,
    description: row.description,
    author:      row.author,
    setter:      row.setter ?? undefined,
    starRating:  row.star_rating != null ? Number(row.star_rating) : undefined,
    sends:       row.sends ?? 0,
    createdAt:   row.created_at,
    betaVideos:  videos.map((v) => ({
      url:         v.url,
      submittedBy: v.handle ?? v.user_id,
    })),
  };
}

/**
 * Fetch a single climb by ID.
 *
 * **Authentication:** Not required — climb details are public.
 *
 * @param _req - Incoming request (unused).
 * @param params - Route params. `id` is the climb UUID.
 *
 * @returns The climb object including embedded `betaVideos` (Instagram URLs
 *   with the handle of the user who submitted each video).
 *
 * @returns `404` if the climb does not exist.
 * @returns `500` on database error.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = await db("climbs")
      .select("climbs.*", "boards.name as board_name")
      .leftJoin("boards", "climbs.board_id", "boards.id")
      .where("climbs.id", id)
      .first();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const videos = await db("ticks")
      .join("users", "ticks.user_id", "users.id")
      .where({ "ticks.climb_id": id })
      .whereNotNull("ticks.instagram_url")
      .select("ticks.instagram_url as url", "users.handle")
      .orderBy("ticks.created_at", "asc");
    return NextResponse.json(toClimb(row, videos));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch climb" }, { status: 500 });
  }
}

/**
 * Update a climb's metadata.
 *
 * **Authentication:** Required — session cookie or `?token=`. Only the
 * original author of the climb may edit it (`403` otherwise).
 *
 * @param req - Incoming request. JSON body (all fields optional):
 *   - `name` — climb name.
 *   - `grade` — V-grade string (`"V0"` – `"V18"`).
 *   - `boardId` — UUID of the board.
 *   - `angle` — wall angle in degrees.
 *   - `description` — free-form description / beta.
 *   - `setter` — route setter name.
 * @param params - Route params. `id` is the climb UUID.
 *
 * @returns The updated climb object.
 *
 * @returns `400` if no fields are provided.
 * @returns `401` if not authenticated.
 * @returns `403` if the caller is not the climb author.
 * @returns `404` if the climb does not exist.
 * @returns `500` on database error.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  try {
    const { id } = await params;
    const climb = await db("climbs").where({ id }).first();
    if (!climb) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (climb.author !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { name, grade, boardId, angle, description, setter } =
      await req.json() as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    if (name        != null) patch.name        = (name as string).trim();
    if (grade       != null) patch.grade       = grade;
    if (boardId     != null) patch.board_id    = boardId;
    if (angle       != null) patch.angle       = Number(angle);
    if (description != null) patch.description = (description as string).trim();
    if (setter      != null) patch.setter      = (setter as string).trim() || null;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    await db("climbs").where({ id }).update(patch);

    const updated = await db("climbs")
      .select("climbs.*", "boards.name as board_name")
      .leftJoin("boards", "climbs.board_id", "boards.id")
      .where("climbs.id", id)
      .first();
    const videos = await db("beta_videos").where({ climb_id: id }).orderBy("sort_order");
    return NextResponse.json(toClimb(updated, videos));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update climb" }, { status: 500 });
  }
}
