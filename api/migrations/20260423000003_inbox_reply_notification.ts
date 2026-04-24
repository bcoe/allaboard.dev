import type { Knex } from "knex";

/**
 * Extend inbox_on_comment_insert so that replying to a comment also notifies
 * the parent comment author (in addition to the tick owner, which was already
 * covered). Avoids a duplicate row when the parent author happens to own the
 * tick.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION inbox_on_comment_insert()
    RETURNS TRIGGER AS $$
    DECLARE
      tick_owner   TEXT;
      parent_author TEXT;
    BEGIN
      SELECT user_id INTO tick_owner FROM ticks WHERE id = NEW.tick_id;

      -- Notify the tick owner (unchanged behaviour)
      IF tick_owner IS NOT NULL AND tick_owner <> NEW.user_id THEN
        INSERT INTO inbox_items (user_id, type, tick_id, comment_id, actor_id)
        VALUES (tick_owner, 'comment', NEW.tick_id, NEW.id, NEW.user_id);
      END IF;

      -- If this is a reply, also notify the parent comment author —
      -- skip if they are the commenter or already received the tick-owner row.
      IF NEW.parent_comment_id IS NOT NULL THEN
        SELECT user_id INTO parent_author
          FROM comments WHERE id = NEW.parent_comment_id;

        IF parent_author IS NOT NULL
           AND parent_author <> NEW.user_id
           AND parent_author <> COALESCE(tick_owner, '') THEN
          INSERT INTO inbox_items (user_id, type, tick_id, comment_id, actor_id)
          VALUES (parent_author, 'comment', NEW.tick_id, NEW.id, NEW.user_id);
        END IF;
      END IF;

      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Restore the previous version (tick owner only)
  await knex.raw(`
    CREATE OR REPLACE FUNCTION inbox_on_comment_insert()
    RETURNS TRIGGER AS $$
    DECLARE
      tick_owner TEXT;
    BEGIN
      SELECT user_id INTO tick_owner FROM ticks WHERE id = NEW.tick_id;
      IF tick_owner IS NOT NULL AND tick_owner <> NEW.user_id THEN
        INSERT INTO inbox_items (user_id, type, tick_id, comment_id, actor_id)
        VALUES (tick_owner, 'comment', NEW.tick_id, NEW.id, NEW.user_id);
      END IF;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);
}
