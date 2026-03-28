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
    const ticks = await db("ticks")
      .where({ climb_id: id })
      .orderBy("created_at", "desc");
    return NextResponse.json(ticks.map(toTick));
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

    const { date, sent, suggestedGrade, rating, comment, instagramUrl } =
      await req.json() as {
        date?: string;
        sent?: boolean;
        suggestedGrade?: string;
        rating: number;
        comment?: string;
        instagramUrl?: string;
      };

    if (!rating || rating < 1 || rating > 4) {
      return NextResponse.json({ error: "rating must be 1–4" }, { status: 400 });
    }

    const resolvedUrl = instagramUrl?.trim() || null;
    const thumbnail   = resolvedUrl ? await fetchInstagramThumbnail(resolvedUrl) : null;

    const tickDate = date ?? new Date().toISOString().slice(0, 10);
    const now = new Date();
    await db("ticks")
      .insert({
        id:                   uuidv4(),
        climb_id:             id,
        user_id:              session.userId,
        date:                 tickDate,
        suggested_grade:      suggestedGrade ?? null,
        rating,
        comment:              comment?.trim() || null,
        instagram_url:        resolvedUrl,
        instagram_thumbnail:  thumbnail,
        sent:                 sent ?? true,
        created_at:           now,
        updated_at:           now,
      })
      .onConflict(["climb_id", "user_id"])
      .merge({
        date:                 tickDate,
        suggested_grade:      suggestedGrade ?? null,
        rating,
        comment:              comment?.trim() || null,
        instagram_url:        resolvedUrl,
        instagram_thumbnail:  thumbnail,
        sent:                 sent ?? true,
        updated_at:           now,
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

    const tick = await db("ticks").where({ climb_id: id, user_id: session.userId }).first();
    return NextResponse.json(toTick(tick), { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save tick" }, { status: 500 });
  }
}

async function fetchInstagramThumbnail(url: string): Promise<string | null> {
  const token = process.env.META_APP_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const oembedUrl =
      `https://graph.facebook.com/v19.0/instagram_oembed` +
      `?url=${encodeURIComponent(url)}&fields=thumbnail_url&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = await res.json() as { thumbnail_url?: string };
    return data.thumbnail_url ?? null;
  } catch {
    return null;
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
    sent:           row.sent,
    createdAt:      row.created_at,
  };
}
