import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // ── 1. Add points column ────────────────────────────────────────────────────
  await knex.schema.alterTable("users", (t) => {
    t.integer("points").notNullable().defaultTo(0);
  });

  // ── 2. SQL helper: base points for a V-grade ────────────────────────────────
  // Mirrors the TypeScript gradePoints() function in src/lib/utils.ts.
  // Formula: ROUND(10 × 1.3^n) where n is the grade index (V5+ = 5.5, V8+ = 8.5).
  await knex.raw(`
    CREATE OR REPLACE FUNCTION grade_base_points(grade text) RETURNS integer AS $$
    DECLARE
      n numeric;
    BEGIN
      n := CASE grade
        WHEN 'V0'  THEN 0
        WHEN 'V1'  THEN 1
        WHEN 'V2'  THEN 2
        WHEN 'V3'  THEN 3
        WHEN 'V4'  THEN 4
        WHEN 'V5'  THEN 5
        WHEN 'V5+' THEN 5.5
        WHEN 'V6'  THEN 6
        WHEN 'V7'  THEN 7
        WHEN 'V8'  THEN 8
        WHEN 'V8+' THEN 8.5
        WHEN 'V9'  THEN 9
        WHEN 'V10' THEN 10
        WHEN 'V11' THEN 11
        WHEN 'V12' THEN 12
        WHEN 'V13' THEN 13
        WHEN 'V14' THEN 14
        WHEN 'V15' THEN 15
        WHEN 'V16' THEN 16
        WHEN 'V17' THEN 17
        WHEN 'V18' THEN 18
        ELSE NULL
      END;
      IF n IS NULL THEN RETURN 0; END IF;
      RETURN ROUND(10.0 * POWER(1.3::numeric, n));
    END;
    $$ LANGUAGE plpgsql IMMUTABLE STRICT;
  `);

  // ── 3. Trigger function ─────────────────────────────────────────────────────
  // Keeps users.points in sync when ticks are inserted, updated, or deleted.
  // Points are only awarded for sent ticks (sent = true).
  // Flash bonus (20% extra) applies when attempts = 1.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ticks_points_sync() RETURNS trigger AS $$
    DECLARE
      v_grade      text;
      v_difficulty numeric;
      v_base       integer;
      v_pts        integer;
    BEGIN
      -- Remove points contributed by the OLD row (DELETE or UPDATE where sent was true)
      IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') AND OLD.sent = true THEN
        SELECT c.grade, COALESCE(b.relative_difficulty, 1.0)
          INTO v_grade, v_difficulty
          FROM climbs c
          LEFT JOIN boards b ON b.id = c.board_id
          WHERE c.id = OLD.climb_id;

        v_base := COALESCE(grade_base_points(v_grade), 0);
        IF v_base > 0 THEN
          IF OLD.attempts = 1 THEN
            v_pts := ROUND((v_base + ROUND(v_base * 0.2)) * v_difficulty);
          ELSE
            v_pts := ROUND(v_base * v_difficulty);
          END IF;
          UPDATE users SET points = GREATEST(0, points - v_pts) WHERE id = OLD.user_id;
        END IF;
      END IF;

      -- Add points contributed by the NEW row (INSERT or UPDATE where sent is now true)
      IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.sent = true THEN
        SELECT c.grade, COALESCE(b.relative_difficulty, 1.0)
          INTO v_grade, v_difficulty
          FROM climbs c
          LEFT JOIN boards b ON b.id = c.board_id
          WHERE c.id = NEW.climb_id;

        v_base := COALESCE(grade_base_points(v_grade), 0);
        IF v_base > 0 THEN
          IF NEW.attempts = 1 THEN
            v_pts := ROUND((v_base + ROUND(v_base * 0.2)) * v_difficulty);
          ELSE
            v_pts := ROUND(v_base * v_difficulty);
          END IF;
          UPDATE users SET points = points + v_pts WHERE id = NEW.user_id;
        END IF;
      END IF;

      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // ── 4. Attach trigger ───────────────────────────────────────────────────────
  await knex.raw(`
    CREATE TRIGGER ticks_points_sync
    AFTER INSERT OR UPDATE OR DELETE ON ticks
    FOR EACH ROW EXECUTE FUNCTION ticks_points_sync();
  `);

  // ── 5. Resync existing data ─────────────────────────────────────────────────
  // Reset all users then compute totals from current ticks.
  await knex("users").update({ points: 0 });
  await knex.raw(`
    UPDATE users u
    SET points = subq.total_points
    FROM (
      SELECT
        t.user_id,
        SUM(
          CASE
            WHEN t.attempts = 1 THEN
              ROUND((grade_base_points(c.grade) + ROUND(grade_base_points(c.grade) * 0.2)) * COALESCE(b.relative_difficulty, 1.0))
            ELSE
              ROUND(grade_base_points(c.grade) * COALESCE(b.relative_difficulty, 1.0))
          END
        )::integer AS total_points
      FROM ticks t
      JOIN climbs c ON c.id = t.climb_id
      LEFT JOIN boards b ON b.id = c.board_id
      WHERE t.sent = true
        AND grade_base_points(c.grade) > 0
      GROUP BY t.user_id
    ) subq
    WHERE u.id = subq.user_id;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP TRIGGER IF EXISTS ticks_points_sync ON ticks`);
  await knex.raw(`DROP FUNCTION IF EXISTS ticks_points_sync()`);
  await knex.raw(`DROP FUNCTION IF EXISTS grade_base_points(text)`);
  await knex.schema.alterTable("users", (t) => {
    t.dropColumn("points");
  });
}
