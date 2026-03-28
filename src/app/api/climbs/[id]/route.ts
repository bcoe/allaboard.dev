import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import db from "@/lib/server/db";
import { sessionOptions, type SessionData } from "@/lib/server/session";

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
      url:       v.url,
      thumbnail: v.thumbnail ?? undefined,
    })),
  };
}

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
      .where({ climb_id: id })
      .whereNotNull("instagram_url")
      .select("instagram_url as url", "instagram_thumbnail as thumbnail")
      .orderBy("created_at", "asc");
    return NextResponse.json(toClimb(row, videos));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch climb" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  try {
    const { id } = await params;
    const climb = await db("climbs").where({ id }).first();
    if (!climb) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (climb.author !== session.userId) {
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
