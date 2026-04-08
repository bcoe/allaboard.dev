import type { Knex } from "knex";

/**
 * Normalize climb names from ALL-CAPS to Title Case.
 *
 * Moonboard's API returns problem names in all-caps (e.g. "GETTING FINGERS READY").
 * The import route converts them with toTitleCase() before writing, but any climbs
 * created before that conversion was in place may still be stored in all-caps.
 *
 * For each climb where name = upper(name) and name ≠ initcap(name):
 *
 *   No collision — a title-case climb with the same (name, grade, board_id, angle)
 *   does not yet exist:
 *     → Rename the climb in place.
 *
 *   Collision — a title-case climb with the same identity already exists
 *   (i.e. the import route already created the properly-cased version):
 *     → Reassign ticks, log_entries, and beta_videos to the existing
 *       title-case climb.
 *     → Delete the all-caps duplicate.
 *
 * Note: this migration is not fully reversible.  Renames can be undone by the
 * down() function below, but merged (collision) rows are permanently deleted
 * and cannot be restored without a separate backup.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$
    DECLARE
      r          RECORD;
      title_name TEXT;
      target_id  UUID;
    BEGIN
      -- Iterate over every climb whose name is entirely uppercase but whose
      -- initcap() form is different (i.e. genuine ALL-CAPS, not single-char words).
      FOR r IN
        SELECT id, name, grade, board_id, angle
        FROM   climbs
        WHERE  name = upper(name)
        AND    name <> initcap(name)
        ORDER  BY name
      LOOP
        title_name := initcap(r.name);

        -- Is there already a properly-cased climb with the same identity?
        SELECT id INTO target_id
        FROM   climbs
        WHERE  name    = title_name
        AND    grade   = r.grade
        AND    board_id IS NOT DISTINCT FROM r.board_id
        AND    angle    IS NOT DISTINCT FROM r.angle;

        IF target_id IS NOT NULL THEN
          -- Collision: reassign every dependent row to the existing title-case
          -- climb before deleting the all-caps duplicate.
          UPDATE ticks        SET climb_id = target_id WHERE climb_id = r.id;
          UPDATE log_entries  SET climb_id = target_id WHERE climb_id = r.id;
          UPDATE beta_videos  SET climb_id = target_id WHERE climb_id = r.id;
          DELETE FROM climbs WHERE id = r.id;
        ELSE
          -- No collision: rename in place.
          UPDATE climbs SET name = title_name WHERE id = r.id;
        END IF;
      END LOOP;
    END;
    $$;
  `);
}

/**
 * Best-effort rollback: converts climbs that are currently in pure Title Case
 * back to ALL-CAPS where upper(name) ≠ name.
 *
 * This does NOT restore climbs that were deleted due to a collision — those
 * rows (and their ticks) are permanently gone.  Only safe-rename operations
 * are reversed here.
 */
export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    UPDATE climbs
    SET    name = upper(name)
    WHERE  name = initcap(name)
    AND    name <> upper(name)
  `);
}
