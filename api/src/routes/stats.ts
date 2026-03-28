import { Router } from "express";
import { computeStats } from "../stats";

const router = Router();

// GET /stats/:userId
router.get("/:userId", async (req, res) => {
  try {
    const stats = await computeStats(req.params.userId);
    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to compute stats" });
  }
});

export default router;
