import { Router } from "express";
import db from "../db";

const router = Router();

// GET /feed?userId=<handle>  — returns recent activity from all users (or a specific user)
router.get("/", async (req, res) => {
  try {
    const query = db("log_entries as le")
      .join("climbs as c", "le.climb_id", "c.id")
      .join("users as u", "le.user_id", "u.id")
      .orderBy("le.date", "desc")
      .limit(50)
      .select(
        "le.id", "le.date", "le.attempts", "le.sent", "le.notes",
        "c.id as climb_id", "c.name as climb_name", "c.grade", "c.board_type",
        "c.angle", "c.description", "c.author", "c.setter", "c.sends", "c.created_at",
        "u.id as user_id", "u.handle", "u.display_name", "u.avatar_color",
        "u.bio", "u.home_board", "u.home_board_angle", "u.joined_at",
        "u.followers_count", "u.following_count",
        "u.personal_best_kilter", "u.personal_best_moonboard",
      );

    if (req.query.userId) {
      query.whereNot("le.user_id", req.query.userId as string);
    }

    const rows = await query;

    // Fetch beta videos for the climbs in the feed
    const climbIds = [...new Set(rows.map((r) => r.climb_id))];
    const videos = climbIds.length
      ? await db("beta_videos").whereIn("climb_id", climbIds).orderBy("sort_order")
      : [];
    const videosByClimb: Record<string, typeof videos> = {};
    for (const v of videos) {
      if (!videosByClimb[v.climb_id]) videosByClimb[v.climb_id] = [];
      videosByClimb[v.climb_id].push(v);
    }

    const activities = rows.map((r) => ({
      id: r.id,
      date: r.date,
      attempts: r.attempts,
      sent: r.sent,
      notes: r.notes ?? undefined,
      user: {
        id: r.user_id,
        handle: r.handle,
        displayName: r.display_name,
        avatarColor: r.avatar_color,
        bio: r.bio,
        homeBoard: r.home_board,
        homeBoardAngle: r.home_board_angle,
        joinedAt: r.joined_at,
        followersCount: r.followers_count,
        followingCount: r.following_count,
        personalBests: {
          ...(r.personal_best_kilter ? { Kilter: r.personal_best_kilter } : {}),
          ...(r.personal_best_moonboard ? { Moonboard: r.personal_best_moonboard } : {}),
        },
      },
      climb: {
        id: r.climb_id,
        name: r.climb_name,
        grade: r.grade,
        boardType: r.board_type,
        angle: r.angle,
        description: r.description,
        author: r.author,
        setter: r.setter,
        sends: r.sends,
        createdAt: r.created_at,
        betaVideos: (videosByClimb[r.climb_id] ?? []).map((v) => ({
          url: v.url,
          thumbnail: v.thumbnail,
          platform: v.platform,
          credit: v.credit ?? undefined,
        })),
      },
    }));

    res.json(activities);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch feed" });
  }
});

export default router;
