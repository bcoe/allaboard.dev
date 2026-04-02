/**
 * Activity feed endpoint — returns the most recent ticks from all users.
 *
 * @module api/feed
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/server/db";

/**
 * Fetch the global activity feed (most recent 50 ticks, newest first).
 *
 * **Authentication:** Not required — the feed is public.
 *
 * @param req - Incoming request. Accepts the optional `userId` query parameter.
 *
 * @remarks
 * Pass `?userId=<handle>` to exclude that user's own ticks from the feed
 * (useful for showing the feed on a logged-in user's home page without
 * surfacing their own activity).
 *
 * Each activity object embeds the full user profile and climb details,
 * including any Instagram beta-video URLs attached to the climb.
 *
 * @returns Array of feed activity objects:
 * ```json
 * [
 *   {
 *     "id": "uuid",
 *     "date": "2026-04-01T...",
 *     "sent": true,
 *     "rating": 3,
 *     "comment": "Great problem!",
 *     "suggestedGrade": "V5",
 *     "instagramUrl": "https://www.instagram.com/reel/...",
 *     "attempts": 4,
 *     "user": { "id": "alex", "handle": "alex", "displayName": "Alex", ... },
 *     "climb": { "id": "uuid", "name": "The Riddler", "grade": "V5", ... }
 *   }
 * ]
 * ```
 *
 * @returns `500` on database error.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("userId");

    const query = db("ticks as t")
      .join("climbs as c", "t.climb_id", "c.id")
      .join("users as u", "t.user_id", "u.id")
      .leftJoin("boards as b", "c.board_id", "b.id")
      .orderBy("t.date", "desc")
      .orderBy("t.created_at", "desc")
      .limit(50)
      .select(
        "t.id", "t.date", "t.sent", "t.rating", "t.comment", "t.suggested_grade", "t.instagram_url", "t.attempts",
        "c.id as climb_id", "c.name as climb_name", "c.grade",
        "c.board_id", "b.name as board_name",
        "c.angle", "c.description", "c.author", "c.setter", "c.sends",
        "c.star_rating", "c.created_at as climb_created_at",
        "u.id as user_id", "u.handle", "u.display_name", "u.avatar_color",
        "u.profile_picture_url",
        "u.bio", "u.home_board", "u.home_board_angle", "u.joined_at",
        "u.followers_count", "u.following_count",
        "u.personal_best_kilter", "u.personal_best_moonboard",
      );

    if (userId) query.whereNot("t.user_id", userId);

    const rows = await query;

    const climbIds = [...new Set(rows.map((r) => r.climb_id))];
    const videos = climbIds.length
      ? await db("ticks")
          .join("users", "ticks.user_id", "users.id")
          .whereIn("ticks.climb_id", climbIds)
          .whereNotNull("ticks.instagram_url")
          .select("ticks.climb_id", "ticks.instagram_url as url", "users.handle")
          .orderBy("ticks.created_at", "asc")
      : [];
    const videosByClimb: Record<string, typeof videos> = {};
    for (const v of videos) {
      if (!videosByClimb[v.climb_id]) videosByClimb[v.climb_id] = [];
      videosByClimb[v.climb_id].push(v);
    }

    const activities = rows.map((r) => ({
      id:             r.id,
      date:           r.date,
      sent:           r.sent,
      rating:         r.rating,
      comment:        r.comment ?? undefined,
      suggestedGrade: r.suggested_grade ?? undefined,
      instagramUrl:   r.instagram_url ?? undefined,
      attempts:       r.attempts ?? undefined,
      user: {
        id: r.user_id, handle: r.handle, displayName: r.display_name,
        avatarColor: r.avatar_color, profilePictureUrl: r.profile_picture_url ?? undefined,
        bio: r.bio, homeBoard: r.home_board, homeBoardAngle: r.home_board_angle,
        joinedAt: r.joined_at, followersCount: r.followers_count,
        followingCount: r.following_count,
        personalBests: {
          ...(r.personal_best_kilter   ? { Kilter: r.personal_best_kilter }     : {}),
          ...(r.personal_best_moonboard ? { Moonboard: r.personal_best_moonboard } : {}),
        },
      },
      climb: {
        id: r.climb_id, name: r.climb_name, grade: r.grade,
        boardId: r.board_id, boardName: r.board_name,
        angle: r.angle ?? 40, description: r.description, author: r.author,
        setter: r.setter ?? undefined, sends: r.sends,
        starRating: r.star_rating != null ? Number(r.star_rating) : undefined,
        createdAt: r.climb_created_at,
        betaVideos: (videosByClimb[r.climb_id] ?? []).map((v) => ({
          url: v.url, submittedBy: v.handle,
        })),
      },
    }));

    return NextResponse.json(activities);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch feed" }, { status: 500 });
  }
}
