/**
 * Leaderboard endpoint — users ranked by climbing points.
 *
 * @module api/leaderboard
 * @packageDocumentation
 */

import { NextResponse } from "next/server";
import db from "@/lib/server/db";

/**
 * Return all users sorted by points descending, with their total tick count,
 * hardest sent grade, and up to five ticks at that grade for the hover tooltip.
 *
 * **Authentication:** Not required — the leaderboard is public.
 *
 * @returns Array of leaderboard entries ordered by `points` descending.
 *   Each entry includes:
 *   - `id`, `handle`, `displayName`, `avatarColor`, `profilePictureUrl`
 *   - `points` — current accumulated point total
 *   - `totalTicks` — all ticks (sent + working)
 *   - `hardestGrade` — highest V-grade sent, or `null` if none
 *   - `hardestGradeTicks` — up to 5 most-recent sent ticks at `hardestGrade`
 *     (climbId, climbName, grade, boardName, angle, attempts, date)
 *
 * @returns `500` on database error.
 */
export async function GET() {
  try {
    // ── Users with total tick count ───────────────────────────────────────────
    const userRows = await db("users as u")
      .leftJoin(
        db("ticks").select("user_id", db.raw("COUNT(*) as cnt")).groupBy("user_id").as("tc"),
        "tc.user_id",
        "u.id",
      )
      .select(
        "u.id",
        "u.handle",
        "u.display_name",
        "u.avatar_color",
        "u.profile_picture_url",
        "u.points",
        db.raw("COALESCE(tc.cnt, 0)::integer AS total_ticks"),
      )
      .orderBy("u.points", "desc");

    // ── Hardest sent grade per user + up to 5 ticks at that grade ────────────
    // Uses a CTE to find each user's hardest grade (via a CASE-based grade index),
    // then returns the 5 most-recent sent ticks at that grade for the tooltip.
    const { rows: hardestRows } = await db.raw(`
      WITH grade_rank AS (
        SELECT grade,
          CASE grade
            WHEN 'V18' THEN 20  WHEN 'V17' THEN 19  WHEN 'V16' THEN 18
            WHEN 'V15' THEN 17  WHEN 'V14' THEN 16  WHEN 'V13' THEN 15
            WHEN 'V12' THEN 14  WHEN 'V11' THEN 13  WHEN 'V10' THEN 12
            WHEN 'V9'  THEN 11  WHEN 'V8+' THEN 10.5 WHEN 'V8' THEN 10
            WHEN 'V7'  THEN 9   WHEN 'V6'  THEN 8   WHEN 'V5+' THEN 7.5
            WHEN 'V5'  THEN 7   WHEN 'V4'  THEN 6   WHEN 'V3'  THEN 5
            WHEN 'V2'  THEN 4   WHEN 'V1'  THEN 3   WHEN 'V0'  THEN 2
            ELSE 0
          END AS idx
        FROM (VALUES
          ('V0'),('V1'),('V2'),('V3'),('V4'),('V5'),('V5+'),('V6'),('V7'),
          ('V8'),('V8+'),('V9'),('V10'),('V11'),('V12'),('V13'),('V14'),
          ('V15'),('V16'),('V17'),('V18')
        ) AS g(grade)
      ),
      hardest_grade AS (
        SELECT DISTINCT ON (t.user_id)
          t.user_id,
          c.grade
        FROM ticks t
        JOIN climbs c ON c.id = t.climb_id
        JOIN grade_rank gr ON gr.grade = c.grade
        WHERE t.sent = true
        ORDER BY t.user_id, gr.idx DESC
      ),
      numbered AS (
        SELECT
          t.user_id,
          t.id,
          t.date,
          t.attempts,
          c.id  AS climb_id,
          c.name AS climb_name,
          c.grade,
          c.angle,
          b.name AS board_name,
          ROW_NUMBER() OVER (PARTITION BY t.user_id ORDER BY t.date DESC) AS rn
        FROM hardest_grade hg
        JOIN ticks t  ON t.user_id  = hg.user_id
        JOIN climbs c ON c.id       = t.climb_id AND c.grade = hg.grade
        LEFT JOIN boards b ON b.id  = c.board_id
        WHERE t.sent = true
      )
      SELECT * FROM numbered WHERE rn <= 5
    `);

    type HardestRow = {
      user_id: string; id: string; date: Date | string; attempts: number | null;
      climb_id: string; climb_name: string; grade: string; angle: number | null;
      board_name: string | null;
    };

    // Index tooltip ticks by user
    const tipsByUser = new Map<string, HardestRow[]>();
    for (const row of hardestRows as HardestRow[]) {
      if (!tipsByUser.has(row.user_id)) tipsByUser.set(row.user_id, []);
      tipsByUser.get(row.user_id)!.push(row);
    }

    const entries = userRows.map((u) => {
      const tips = tipsByUser.get(u.id) ?? [];
      return {
        id:               u.id,
        handle:           u.handle,
        displayName:      u.display_name,
        avatarColor:      u.avatar_color,
        profilePictureUrl: u.profile_picture_url ?? undefined,
        points:           u.points ?? 0,
        totalTicks:       u.total_ticks,
        hardestGrade:     tips[0]?.grade ?? null,
        hardestGradeTicks: tips.map((t) => ({
          id:        t.id,
          climbId:   t.climb_id,
          climbName: t.climb_name,
          grade:     t.grade,
          boardName: t.board_name ?? "",
          angle:     t.angle ?? null,
          attempts:  t.attempts ?? undefined,
          date:      t.date instanceof Date ? t.date.toISOString() : String(t.date),
        })),
      };
    });

    return NextResponse.json(entries);
  } catch (err) {
    console.error("[leaderboard]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
