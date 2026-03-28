import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import db from "@/lib/server/db";
import { sessionOptions, type SessionData } from "@/lib/server/session";
import { ALL_GRADES } from "@/lib/utils";

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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const q         = searchParams.get("q")?.trim() ?? "";
    const gradeMin  = searchParams.get("gradeMin");
    const gradeMax  = searchParams.get("gradeMax");
    const angleMin  = searchParams.get("angleMin");
    const angleMax  = searchParams.get("angleMax");
    const boardId   = searchParams.get("boardId");
    const limit     = Math.min(Number(searchParams.get("limit") ?? 25), 100);
    const offset    = Math.max(Number(searchParams.get("offset") ?? 0), 0);

    const query = db("climbs")
      .select("climbs.*", "boards.name as board_name")
      .leftJoin("boards", "climbs.board_id", "boards.id")
      .orderBy("climbs.name", "asc")
      .limit(limit + 1)   // fetch one extra to determine hasMore
      .offset(offset);

    if (q)      query.whereILike("climbs.name", `%${q}%`);
    if (boardId) query.where("climbs.board_id", boardId);

    if (gradeMin || gradeMax) {
      const minIdx = gradeMin ? ALL_GRADES.indexOf(gradeMin as never) : 0;
      // If no gradeMax, treat it as a single-grade filter (same as min)
      const maxIdx = gradeMax ? ALL_GRADES.indexOf(gradeMax as never) : minIdx;
      const range  = ALL_GRADES.slice(
        Math.max(0, minIdx),
        Math.min(ALL_GRADES.length, maxIdx + 1),
      );
      if (range.length > 0) query.whereIn("climbs.grade", range);
    }

    if (angleMin) query.where("climbs.angle", ">=", Number(angleMin));
    if (angleMax) query.where("climbs.angle", "<=", Number(angleMax));

    const rows    = await query;
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();

    const ids     = rows.map((r) => r.id);
    // Beta videos come from ticks that have an instagram URL
    const videos  = ids.length
      ? await db("ticks")
          .whereIn("climb_id", ids)
          .whereNotNull("instagram_url")
          .select("climb_id", "instagram_url as url", "instagram_thumbnail as thumbnail")
          .orderBy("created_at", "asc")
      : [];

    const byClimb: Record<string, Record<string, unknown>[]> = {};
    for (const v of videos) {
      if (!byClimb[v.climb_id as string]) byClimb[v.climb_id as string] = [];
      byClimb[v.climb_id as string].push(v);
    }

    return NextResponse.json({ climbs: rows.map((r) => toClimb(r, byClimb[r.id] ?? [])), hasMore });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch climbs" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const { name, grade, boardId, angle, description, setter } =
      await req.json() as {
        name: string;
        grade: string;
        boardId: string;
        angle?: number;
        description?: string;
        setter?: string;
      };

    if (!name?.trim() || !grade || !boardId) {
      return NextResponse.json({ error: "name, grade and boardId are required" }, { status: 400 });
    }

    const board = await db("boards").where({ id: boardId }).first();
    if (!board) return NextResponse.json({ error: "Invalid board" }, { status: 400 });

    const resolvedAngle = angle ?? 40;

    // Check uniqueness before insert for a friendly error
    const duplicate = await db("climbs")
      .where({ name: name.trim(), grade, board_id: boardId, angle: resolvedAngle })
      .first();
    if (duplicate) {
      return NextResponse.json(
        { error: "A climb with this name, grade, angle and board already exists" },
        { status: 409 },
      );
    }

    const id = uuidv4();
    await db("climbs").insert({
      id,
      name:        name.trim(),
      grade,
      board_id:    boardId,
      angle:       resolvedAngle,
      description: description?.trim() ?? "",
      author:      session.userId,
      setter:      setter?.trim() || null,
      sends:       0,
    });

    const row = await db("climbs")
      .select("climbs.*", "boards.name as board_name")
      .leftJoin("boards", "climbs.board_id", "boards.id")
      .where("climbs.id", id)
      .first();
    return NextResponse.json(toClimb(row, []), { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create climb" }, { status: 500 });
  }
}

