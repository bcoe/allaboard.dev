/**
 * Climbs collection endpoint — list and submit climbs.
 *
 * @module api/climbs
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import db from "@/lib/server/db";
import { resolveUserId } from "@/lib/server/resolveUserId";
import { ALL_GRADES } from "@/lib/utils";

function toClimb(row: Record<string, unknown>, videos: Record<string, unknown>[]) {
  return {
    id:          row.id,
    name:        row.name,
    grade:       row.grade,
    boardId:     row.board_id,
    boardName:   row.board_name ?? null,
    angle:       row.angle ?? undefined,
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
 * List climbs with optional filtering and sorting.
 *
 * **Authentication:** Not required — the climb directory is public.
 *
 * @param req - Incoming request. Supported query parameters:
 *   - `q` — case-insensitive name search substring.
 *   - `gradeMin` — lower bound grade (e.g. `"V4"`); inclusive.
 *   - `gradeMax` — upper bound grade (e.g. `"V8"`); inclusive.
 *   - `angleMin` — minimum wall angle (degrees); inclusive.
 *   - `angleMax` — maximum wall angle (degrees); inclusive.
 *   - `boardId` — filter to a specific board UUID.
 *   - `limit` — results per page, max 100 (default 25).
 *   - `offset` — pagination offset (default 0).
 *   - `sort` — one of `sends_desc` *(default)*, `star_rating_desc`,
 *     `grade_asc`, `grade_desc`, `has_video`.
 *
 * @returns Paginated response:
 * ```json
 * {
 *   "climbs": [ { "id": "uuid", "name": "The Riddler", "grade": "V5", ... } ],
 *   "hasMore": true
 * }
 * ```
 *
 * @returns `500` on database error.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const q         = searchParams.get("q")?.trim() ?? "";
    const gradeMin  = searchParams.get("gradeMin");
    const gradeMax  = searchParams.get("gradeMax");
    const angleMin  = searchParams.get("angleMin");
    const angleMax  = searchParams.get("angleMax");
    // Accept ?boardIds=uuid1,uuid2 (multi) or legacy ?boardId=uuid (single)
    const boardIds  = searchParams.get("boardIds")?.split(",").filter(Boolean)
                   ?? (searchParams.get("boardId") ? [searchParams.get("boardId")!] : []);
    const limit     = Math.min(Number(searchParams.get("limit") ?? 25), 100);
    const offset    = Math.max(Number(searchParams.get("offset") ?? 0), 0);
    const sort      = searchParams.get("sort") ?? "sends_desc";

    // Helper: apply the WHERE clauses shared by both the data query and the count query.
    function applyFilters<T extends object>(q_: typeof db): T {
      const builder = q_ as unknown as ReturnType<typeof db>;
      if (q) builder.whereILike("climbs.name", `%${q}%`);
      if (boardIds.length === 1) builder.where("climbs.board_id", boardIds[0]);
      else if (boardIds.length > 1) builder.whereIn("climbs.board_id", boardIds);

      if (gradeMin || gradeMax) {
        const minIdx = gradeMin ? ALL_GRADES.indexOf(gradeMin as never) : 0;
        const maxIdx = gradeMax ? ALL_GRADES.indexOf(gradeMax as never) : minIdx;
        const range  = ALL_GRADES.slice(Math.max(0, minIdx), Math.min(ALL_GRADES.length, maxIdx + 1));
        if (range.length > 0) builder.whereIn("climbs.grade", range);
      }

      if (angleMin) builder.where("climbs.angle", ">=", Number(angleMin));
      if (angleMax) builder.where("climbs.angle", "<=", Number(angleMax));
      return builder as unknown as T;
    }

    const needsVideoJoin = sort === "has_video";

    const dataQuery = db("climbs")
      .select(
        "climbs.*",
        "boards.name as board_name",
        ...(needsVideoJoin ? [db.raw("(vid.climb_id IS NOT NULL) as has_video")] : []),
      )
      .leftJoin("boards", "climbs.board_id", "boards.id")
      .limit(limit + 1)
      .offset(offset);

    if (needsVideoJoin) {
      dataQuery.leftJoin(
        db("ticks").whereNotNull("instagram_url").distinct("climb_id").as("vid"),
        "climbs.id",
        "vid.climb_id",
      );
    }

    // Apply sort order
    if (sort === "star_rating_desc") {
      dataQuery.orderByRaw("climbs.star_rating DESC NULLS LAST").orderBy("climbs.name", "asc");
    } else if (sort === "grade_desc") {
      const caseExpr = ALL_GRADES.map((g, i) => `WHEN '${g}' THEN ${i}`).join(" ");
      dataQuery.orderByRaw(`CASE climbs.grade ${caseExpr} ELSE 999 END DESC`).orderBy("climbs.name", "asc");
    } else if (sort === "grade_asc") {
      const caseExpr = ALL_GRADES.map((g, i) => `WHEN '${g}' THEN ${i}`).join(" ");
      dataQuery.orderByRaw(`CASE climbs.grade ${caseExpr} ELSE 999 END ASC`).orderBy("climbs.name", "asc");
    } else if (sort === "has_video") {
      dataQuery.orderByRaw("(vid.climb_id IS NOT NULL) DESC").orderBy("climbs.sends", "desc").orderBy("climbs.name", "asc");
    } else {
      // sends_desc (default)
      dataQuery.orderBy("climbs.sends", "desc").orderBy("climbs.name", "asc");
    }

    applyFilters(dataQuery as unknown as typeof db);

    const countQuery = db("climbs")
      .leftJoin("boards", "climbs.board_id", "boards.id")
      .count("climbs.id as total");
    applyFilters(countQuery as unknown as typeof db);

    const [rows, [{ total: totalRaw }]] = await Promise.all([dataQuery, countQuery]);
    const total   = Number(totalRaw ?? 0);
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

    return NextResponse.json({ climbs: rows.map((r) => toClimb(r, byClimb[r.id] ?? [])), hasMore, total });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch climbs" }, { status: 500 });
  }
}

/**
 * Submit a new climb to the directory.
 *
 * **Authentication:** Required — session cookie or `?token=`.
 * The authenticated user becomes the `author` of the climb.
 *
 * @param req - Incoming request. JSON body:
 *   - `name` *(required)* — climb name.
 *   - `grade` *(required)* — V-grade string (`"V0"` – `"V18"`).
 *   - `boardId` *(required)* — UUID of the board the climb is set on.
 *   - `angle` *(optional, default 40)* — wall angle in degrees; omitted for spray walls.
 *   - `description` *(optional)* — free-form description / beta.
 *   - `setter` *(optional)* — name of the route setter (may differ from author).
 *
 * @returns The created climb object with status `201`.
 *
 * @returns `400` if `name`, `grade`, or `boardId` are missing, or if `boardId` is invalid.
 * @returns `401` if not authenticated.
 * @returns `409` if a climb with the same name, grade, angle, and board already exists.
 * @returns `500` on database error.
 */
export async function POST(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) {
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

    const isSprayWall = board.type === "spray_wall";
    const resolvedAngle = isSprayWall ? null : (angle ?? 40);

    // Check uniqueness before insert for a friendly error
    const dupQuery = db("climbs").where({ name: name.trim(), grade, board_id: boardId });
    if (resolvedAngle !== null) dupQuery.where({ angle: resolvedAngle });
    const duplicate = await dupQuery.first();
    if (duplicate) {
      return NextResponse.json(
        { error: "A climb with this name, grade, angle and board already exists" },
        { status: 409 },
      );
    }

    const id = uuidv4();
    const setterName = setter?.trim() || null;
    await db("climbs").insert({
      id,
      name:        name.trim(),
      grade,
      board_id:    boardId,
      angle:       resolvedAngle,
      description: description?.trim() ?? "",
      author:      userId,
      setter:      setterName,
      sends:       0,
    });

    // Keep the setters lookup table in sync
    if (setterName) {
      await db.raw(
        "INSERT INTO setters (name) VALUES (?) ON CONFLICT (name) DO NOTHING",
        [setterName],
      );
    }

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
