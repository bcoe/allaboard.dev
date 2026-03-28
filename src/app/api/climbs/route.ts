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
      url:         v.url,
      submittedBy: v.handle ?? v.user_id,
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
    const sort      = searchParams.get("sort") ?? "sends_desc";

    const needsVideoJoin = sort === "has_video";

    const query = db("climbs")
      .select(
        "climbs.*",
        "boards.name as board_name",
        ...(needsVideoJoin ? [db.raw("(vid.climb_id IS NOT NULL) as has_video")] : []),
      )
      .leftJoin("boards", "climbs.board_id", "boards.id")
      .limit(limit + 1)
      .offset(offset);

    if (needsVideoJoin) {
      query.leftJoin(
        db("ticks").whereNotNull("instagram_url").distinct("climb_id").as("vid"),
        "climbs.id",
        "vid.climb_id",
      );
    }

    // Apply sort order
    if (sort === "star_rating_desc") {
      query.orderByRaw("climbs.star_rating DESC NULLS LAST").orderBy("climbs.name", "asc");
    } else if (sort === "grade_desc") {
      const caseExpr = ALL_GRADES.map((g, i) => `WHEN '${g}' THEN ${i}`).join(" ");
      query.orderByRaw(`CASE climbs.grade ${caseExpr} ELSE 999 END DESC`).orderBy("climbs.name", "asc");
    } else if (sort === "grade_asc") {
      const caseExpr = ALL_GRADES.map((g, i) => `WHEN '${g}' THEN ${i}`).join(" ");
      query.orderByRaw(`CASE climbs.grade ${caseExpr} ELSE 999 END ASC`).orderBy("climbs.name", "asc");
    } else if (sort === "has_video") {
      query.orderByRaw("(vid.climb_id IS NOT NULL) DESC").orderBy("climbs.sends", "desc").orderBy("climbs.name", "asc");
    } else {
      // sends_desc (default)
      query.orderBy("climbs.sends", "desc").orderBy("climbs.name", "asc");
    }

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
    const videos  = ids.length
      ? await db("ticks")
          .join("users", "ticks.user_id", "users.id")
          .whereIn("ticks.climb_id", ids)
          .whereNotNull("ticks.instagram_url")
          .select("ticks.climb_id", "ticks.instagram_url as url", "users.handle")
          .orderBy("ticks.created_at", "asc")
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

