import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/server/db";

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const rows = await db("ticks as t")
      .join("climbs as c", "t.climb_id", "c.id")
      .leftJoin("boards as b", "c.board_id", "b.id")
      .where("t.user_id", userId)
      .orderBy("t.date", "desc")
      .orderBy("t.created_at", "desc")
      .select(
        "t.id", "t.date", "t.sent", "t.rating", "t.comment",
        "t.suggested_grade", "t.instagram_url", "t.created_at",
        "c.id as climb_id", "c.name as climb_name", "c.grade",
        "c.angle", "b.name as board_name",
      );

    return NextResponse.json(rows.map((r) => ({
      id:             r.id,
      climbId:        r.climb_id,
      climbName:      r.climb_name,
      grade:          r.grade,
      boardName:      r.board_name ?? "",
      angle:          r.angle ?? 40,
      date:           r.date,
      sent:           r.sent,
      rating:         r.rating,
      comment:        r.comment ?? undefined,
      suggestedGrade: r.suggested_grade ?? undefined,
      instagramUrl:   r.instagram_url ?? undefined,
      createdAt:      r.created_at,
    })));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch ticks" }, { status: 500 });
  }
}
