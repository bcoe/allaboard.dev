import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import db from "@/lib/server/db";
import { sessionOptions, type SessionData } from "@/lib/server/session";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const rows = await db("ticks")
      .join("users", "ticks.user_id", "users.id")
      .where({ "ticks.climb_id": id })
      .orderBy("ticks.date", "desc")
      .orderBy("ticks.created_at", "desc")
      .select(
        "ticks.id", "ticks.date", "ticks.sent", "ticks.rating",
        "ticks.comment", "ticks.suggested_grade", "ticks.instagram_url",
        "ticks.attempts", "ticks.created_at",
        "users.handle", "users.display_name", "users.avatar_color",
        "users.profile_picture_url",
      );
    return NextResponse.json(rows.map((r) => ({
      id:                   r.id,
      userHandle:           r.handle,
      userDisplayName:      r.display_name,
      userAvatarColor:      r.avatar_color,
      userProfilePictureUrl: r.profile_picture_url ?? undefined,
      date:                 r.date,
      sent:                 r.sent,
      rating:               r.rating,
      comment:              r.comment ?? undefined,
      suggestedGrade:       r.suggested_grade ?? undefined,
      instagramUrl:         r.instagram_url ?? undefined,
      attempts:             r.attempts ?? undefined,
      createdAt:            r.created_at,
    })));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch ticks" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  try {
    const { id } = await params;
    const climb = await db("climbs").where({ id }).first();
    if (!climb) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { date, sent, attempts, suggestedGrade, rating, comment, instagramUrl } =
      await req.json() as {
        date?: string;
        sent?: boolean;
        attempts?: number;
        suggestedGrade?: string;
        rating: number;
        comment?: string;
        instagramUrl?: string;
      };

    if (!rating || rating < 1 || rating > 4) {
      return NextResponse.json({ error: "rating must be 1–4" }, { status: 400 });
    }

    const resolvedUrl = instagramUrl?.trim() || null;

    const now = new Date();
    // Combine the user-selected date with the current time of day so the
    // timestamp is precise to the second while the user only picks a date.
    let tickTimestamp: Date;
    if (date) {
      const [y, m, d] = date.split("-").map(Number);
      tickTimestamp = new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    } else {
      tickTimestamp = now;
    }

    const tickId = uuidv4();
    await db("ticks").insert({
      id:              tickId,
      climb_id:        id,
      user_id:         session.userId,
      date:            tickTimestamp,
      suggested_grade: suggestedGrade ?? null,
      rating,
      comment:         comment?.trim() || null,
      instagram_url:   resolvedUrl,
      attempts:        attempts ?? null,
      sent:            sent ?? true,
      created_at:      now,
      updated_at:      now,
    });

    // Recalculate aggregates on the climb
    const [ratingResult] = await db("ticks")
      .where({ climb_id: id })
      .avg("rating as avg");
    const [sendsResult] = await db("ticks")
      .where({ climb_id: id, sent: true })
      .count("id as count");

    await db("climbs").where({ id }).update({
      star_rating: ratingResult?.avg != null ? Number(Number(ratingResult.avg).toFixed(2)) : null,
      sends:       Number(sendsResult?.count ?? 0),
    });

    const tick = await db("ticks").where({ id: tickId }).first();
    return NextResponse.json(toTick(tick), { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save tick" }, { status: 500 });
  }
}


function toTick(row: Record<string, unknown>) {
  return {
    id:             row.id,
    climbId:        row.climb_id,
    userId:         row.user_id,
    date:           row.date,
    suggestedGrade: row.suggested_grade ?? undefined,
    rating:         row.rating,
    comment:        row.comment ?? undefined,
    instagramUrl:   row.instagram_url ?? undefined,
    attempts:       row.attempts ?? undefined,
    sent:           row.sent,
    createdAt:      row.created_at,
  };
}
