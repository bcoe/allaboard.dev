import { Router } from "express";
import db from "../db";

const router = Router();

function toUser(row: Record<string, unknown>) {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    bio: row.bio,
    homeBoard: row.home_board,
    homeBoardAngle: row.home_board_angle,
    joinedAt: row.joined_at,
    followersCount: row.followers_count,
    followingCount: row.following_count,
    personalBests: {
      ...(row.personal_best_kilter ? { Kilter: row.personal_best_kilter } : {}),
      ...(row.personal_best_moonboard ? { Moonboard: row.personal_best_moonboard } : {}),
    },
  };
}

// GET /users
router.get("/", async (_req, res) => {
  try {
    const rows = await db("users").orderBy("handle");
    res.json(rows.map(toUser));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// GET /users/:handle
router.get("/:handle", async (req, res) => {
  try {
    const row = await db("users").where({ handle: req.params.handle }).first();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(toUser(row));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// PATCH /users/:handle
router.patch("/:handle", async (req, res) => {
  try {
    const { displayName, bio, homeBoard, homeBoardAngle, personalBests } = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (displayName !== undefined) patch.display_name = displayName;
    if (bio !== undefined) patch.bio = bio;
    if (homeBoard !== undefined) patch.home_board = homeBoard;
    if (homeBoardAngle !== undefined) patch.home_board_angle = homeBoardAngle;
    if (personalBests && typeof personalBests === "object") {
      const pb = personalBests as Record<string, string>;
      if (pb.Kilter !== undefined) patch.personal_best_kilter = pb.Kilter;
      if (pb.Moonboard !== undefined) patch.personal_best_moonboard = pb.Moonboard;
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: "No fields to update" });
    await db("users").where({ handle: req.params.handle }).update(patch);
    const row = await db("users").where({ handle: req.params.handle }).first();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(toUser(row));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update user" });
  }
});

export default router;
