/**
 * Ticks for a specific climb — list ticks and submit new ones.
 *
 * @module api/climbs/id/ticks
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import db from "@/lib/server/db";
import { resolveUserId } from "@/lib/server/resolveUserId";

/**
 * List all ticks for a climb, newest first.
 *
 * **Authentication:** Not required — ticks are public.
 *
 * @param _req - Incoming request (unused).
 * @param params - Route params. `id` is the climb UUID.
 *
 * @returns Array of tick objects, each embedding the submitting user's
 *   handle, display name, avatar color, and profile picture URL.
 *
 * @returns `500` on database error.
 */
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
        "ticks.attempts", "ticks.comments_count", "ticks.created_at",
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
      commentsCount:        r.comments_count,
      createdAt:            r.created_at,
    })));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch ticks" }, { status: 500 });
  }
}

/**
 * Submit a tick (send record) for a climb.
 *
 * **Authentication:** Required — session cookie. One tick per user per climb;
 * resubmitting replaces the existing tick.
 *
 * @param req - Incoming request. JSON body:
 *   - `rating` *(required)* — star rating 1–4.
 *   - `date` *(optional)* — ISO date string (`"YYYY-MM-DD"`); defaults to today.
 *   - `sent` *(optional, default true)* — whether the climb was completed.
 *   - `attempts` *(optional)* — number of attempts.
 *   - `suggestedGrade` *(optional)* — the climber's grade opinion (`"V0"`–`"V18"`).
 *   - `comment` *(optional)* — free-form send notes.
 *   - `instagramUrl` *(optional)* — URL to an Instagram post/reel of the send.
 * @param params - Route params. `id` is the climb UUID.
 *
 * @remarks
 * `climbs.star_rating` and `climbs.sends` are kept in sync automatically
 * by a database trigger on the ticks table.
 *
 * @returns The created tick object with status `201`.
 *
 * @returns `400` if `rating` is missing or outside 1–4.
 * @returns `401` if not authenticated.
 * @returns `404` if the climb does not exist.
 * @returns `500` on database error.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

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
      user_id:         userId,
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
