import type { Knex } from "knex";

/**
 * Keeps tick_sessions in sync with the ticks table automatically, following
 * the same "trigger is the single source of truth" pattern as
 * follows_count_trigger and climb_stats_trigger.
 *
 * A session is the set of a user's ticks logged within 6 hours of each other:
 * ordered by time, a new session begins whenever the gap from the previous
 * tick exceeds 6 hours (grouping is chained, so a single session may span more
 * than 6 hours in total). The session's date is the calendar day of its first
 * tick; sessions are numbered per day (1, 2, 3, …).
 *
 * This migration creates:
 *   - grade_rank(text)            — orders V-scale grades (incl. V5+/V8+)
 *   - recompute_tick_sessions(uid)— rebuilds one user's sessions from scratch
 *   - handle_tick_sessions_sync() — trigger fn dispatching to the recompute
 *   - tick_sessions_sync trigger  — fires on the columns that affect grouping
 *
 * The trigger is scoped to `UPDATE OF date, user_id, sent, duration_minutes`
 * so that rating/comment-only edits don't rebuild sessions, and so the
 * recompute (which only writes tick_sessions, never ticks) can never recurse
 * or disturb the existing climb-stats trigger.
 *
 * Existing sessions are backfilled at the end of `up()`.
 *
 * Performance note: this is a row-level trigger, so a bulk import that inserts
 * N ticks for one user triggers N full recomputes (O(N^2)). That is acceptable
 * at personal-logbook scale (hundreds–thousands of ticks) and keeps the
 * implementation consistent with the other row-level triggers in this app.
 */
export async function up(knex: Knex): Promise<void> {
  // 1. Grade ordering helper (V0 < V1 < … < V5 < V5+ < V6 < … < V8 < V8+ < V9 < … < V18).
  //    Returns -1 for unknown grades so they are ignored when picking "hardest".
  await knex.raw(`
    CREATE OR REPLACE FUNCTION grade_rank(g text)
    RETURNS int AS $$
      SELECT CASE g
        WHEN 'V0'  THEN 0  WHEN 'V1'  THEN 1  WHEN 'V2'  THEN 2  WHEN 'V3' THEN 3
        WHEN 'V4'  THEN 4  WHEN 'V5'  THEN 5  WHEN 'V5+' THEN 6  WHEN 'V6' THEN 7
        WHEN 'V7'  THEN 8  WHEN 'V8'  THEN 9  WHEN 'V8+' THEN 10 WHEN 'V9' THEN 11
        WHEN 'V10' THEN 12 WHEN 'V11' THEN 13 WHEN 'V12' THEN 14 WHEN 'V13' THEN 15
        WHEN 'V14' THEN 16 WHEN 'V15' THEN 17 WHEN 'V16' THEN 18 WHEN 'V17' THEN 19
        WHEN 'V18' THEN 20
        ELSE -1
      END;
    $$ LANGUAGE sql IMMUTABLE;
  `);

  // 2. Rebuild one user's sessions from their ticks.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION recompute_tick_sessions(uid text)
    RETURNS void AS $$
    BEGIN
      DELETE FROM tick_sessions WHERE user_id = uid;

      INSERT INTO tick_sessions
        (id, user_id, date, session_number, started_at, ended_at,
         tick_count, sent_count, hardest_grade, total_minutes, created_at)
      WITH ordered AS (
        SELECT
          t.date,
          t.created_at,
          t.sent,
          t.duration_minutes,
          c.grade,
          CASE
            WHEN LAG(t.date) OVER w IS NULL
              OR t.date - LAG(t.date) OVER w > interval '6 hours'
            THEN 1 ELSE 0
          END AS is_new
        FROM ticks t
        JOIN climbs c ON c.id = t.climb_id
        WHERE t.user_id = uid
        WINDOW w AS (ORDER BY t.date, t.created_at)
      ),
      grouped AS (
        SELECT
          o.*,
          SUM(is_new) OVER (ORDER BY date, created_at ROWS UNBOUNDED PRECEDING) AS grp
        FROM ordered o
      ),
      agg AS (
        SELECT
          g.grp,
          MIN(g.date) AS started_at,
          MAX(g.date) AS ended_at,
          COUNT(*)::int AS tick_count,
          (COUNT(*) FILTER (WHERE g.sent))::int AS sent_count,
          SUM(g.duration_minutes)::int AS total_minutes,
          (
            SELECT g2.grade
            FROM grouped g2
            WHERE g2.grp = g.grp AND g2.sent AND grade_rank(g2.grade) >= 0
            ORDER BY grade_rank(g2.grade) DESC
            LIMIT 1
          ) AS hardest_grade
        FROM grouped g
        GROUP BY g.grp
      ),
      numbered AS (
        SELECT
          a.*,
          (ROW_NUMBER() OVER (PARTITION BY a.started_at::date ORDER BY a.started_at))::int AS session_number
        FROM agg a
      )
      SELECT
        uid || '-' || to_char(started_at::date, 'YYYY-MM-DD') || '-' || session_number,
        uid,
        started_at::date,
        session_number,
        started_at,
        ended_at,
        tick_count,
        sent_count,
        hardest_grade,
        total_minutes,
        now()
      FROM numbered;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // 3. Trigger dispatcher — recompute the affected user(s).
  await knex.raw(`
    CREATE OR REPLACE FUNCTION handle_tick_sessions_sync()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        PERFORM recompute_tick_sessions(OLD.user_id);
      ELSIF TG_OP = 'UPDATE' THEN
        PERFORM recompute_tick_sessions(NEW.user_id);
        IF NEW.user_id <> OLD.user_id THEN
          PERFORM recompute_tick_sessions(OLD.user_id);
        END IF;
      ELSE -- INSERT
        PERFORM recompute_tick_sessions(NEW.user_id);
      END IF;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // 4. Attach the trigger, scoped to the columns that affect grouping/aggregates.
  await knex.raw(`
    CREATE TRIGGER tick_sessions_sync
    AFTER INSERT OR DELETE OR UPDATE OF date, user_id, sent, duration_minutes ON ticks
    FOR EACH ROW EXECUTE FUNCTION handle_tick_sessions_sync();
  `);

  // 5. Backfill: rebuild sessions for every user who already has ticks.
  await knex.raw(`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN SELECT DISTINCT user_id FROM ticks LOOP
        PERFORM recompute_tick_sessions(r.user_id);
      END LOOP;
    END $$;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP TRIGGER IF EXISTS tick_sessions_sync ON ticks;`);
  await knex.raw(`DROP FUNCTION IF EXISTS handle_tick_sessions_sync;`);
  await knex.raw(`DROP FUNCTION IF EXISTS recompute_tick_sessions(text);`);
  await knex.raw(`DROP FUNCTION IF EXISTS grade_rank(text);`);
}
