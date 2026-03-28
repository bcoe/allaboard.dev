import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import db from "../db";

const router = Router();

function toClimb(row: Record<string, unknown>, videos: Record<string, unknown>[]) {
  return {
    id: row.id,
    name: row.name,
    grade: row.grade,
    boardType: row.board_type,
    angle: row.angle,
    description: row.description,
    author: row.author,
    setter: row.setter,
    sends: row.sends,
    createdAt: row.created_at,
    betaVideos: videos.map((v) => ({
      url: v.url,
      thumbnail: v.thumbnail,
      platform: v.platform,
      credit: v.credit ?? undefined,
    })),
  };
}

// GET /climbs
router.get("/", async (_req, res) => {
  try {
    const rows = await db("climbs").orderBy("created_at", "desc");
    const climbIds = rows.map((r) => r.id);
    const videos = climbIds.length
      ? await db("beta_videos").whereIn("climb_id", climbIds).orderBy("sort_order")
      : [];

    const videosByClimb: Record<string, Record<string, unknown>[]> = {};
    for (const v of videos) {
      if (!videosByClimb[v.climb_id]) videosByClimb[v.climb_id] = [];
      videosByClimb[v.climb_id].push(v);
    }

    res.json(rows.map((r) => toClimb(r, videosByClimb[r.id] ?? [])));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch climbs" });
  }
});

// GET /climbs/:id
router.get("/:id", async (req, res) => {
  try {
    const row = await db("climbs").where({ id: req.params.id }).first();
    if (!row) return res.status(404).json({ error: "Not found" });
    const videos = await db("beta_videos").where({ climb_id: row.id }).orderBy("sort_order");
    res.json(toClimb(row, videos));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch climb" });
  }
});

// POST /climbs
router.post("/", async (req, res) => {
  try {
    const { name, grade, boardType, angle, description, author, setter, sends } = req.body as Record<string, unknown>;
    const id = uuidv4();
    await db("climbs").insert({
      id,
      name,
      grade,
      board_type: boardType,
      angle: angle ?? null,
      description,
      author: author ?? "alex_sends",
      setter: setter ?? null,
      sends: sends ?? 0,
    });
    const row = await db("climbs").where({ id }).first();
    res.status(201).json(toClimb(row, []));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create climb" });
  }
});

export default router;
