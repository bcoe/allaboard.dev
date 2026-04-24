import type { Knex } from "knex";

/**
 * Replace the single-level parent lookup with a full ancestor walk.
 *
 * Previous behaviour: a reply notified the tick owner + the direct parent author.
 * New behaviour: a reply notifies the tick owner + every distinct author anywhere
 * above the reply in the comment thread, with no duplicate rows.
 *
 * A TEXT[] of already-notified user ids (seeded with the commenter themselves)
 * acts as the dedup guard throughout.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION inbox_on_comment_insert()
    RETURNS TRIGGER AS $$
    DECLARE
      tick_owner      TEXT;
      notified_users  TEXT[] := ARRAY[NEW.user_id::TEXT];
      cur_parent_id   UUID;
      anc_user_id     TEXT;
      anc_parent_id   UUID;
    BEGIN
      -- Always notify the tick owner (unless they are the commenter)
      SELECT user_id INTO tick_owner FROM ticks WHERE id = NEW.tick_id;
      IF tick_owner IS NOT NULL AND NOT (tick_owner = ANY(notified_users)) THEN
        INSERT INTO inbox_items (user_id, type, tick_id, comment_id, actor_id)
        VALUES (tick_owner, 'comment', NEW.tick_id, NEW.id, NEW.user_id);
        notified_users := notified_users || ARRAY[tick_owner];
      END IF;

      -- Walk every ancestor in the thread, notifying each unique author once
      cur_parent_id := NEW.parent_comment_id;
      WHILE cur_parent_id IS NOT NULL LOOP
        SELECT user_id, parent_comment_id
          INTO anc_user_id, anc_parent_id
          FROM comments
         WHERE id = cur_parent_id;

        IF anc_user_id IS NOT NULL AND NOT (anc_user_id = ANY(notified_users)) THEN
          INSERT INTO inbox_items (user_id, type, tick_id, comment_id, actor_id)
          VALUES (anc_user_id, 'comment', NEW.tick_id, NEW.id, NEW.user_id);
          notified_users := notified_users || ARRAY[anc_user_id];
        END IF;

        cur_parent_id := anc_parent_id;
      END LOOP;

      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Restore the direct-parent-only version from migration 003
  await knex.raw(`
    CREATE OR REPLACE FUNCTION inbox_on_comment_insert()
    RETURNS TRIGGER AS $$
    DECLARE
      tick_owner   TEXT;
      parent_author TEXT;
    BEGIN
      SELECT user_id INTO tick_owner FROM ticks WHERE id = NEW.tick_id;

      IF tick_owner IS NOT NULL AND tick_owner <> NEW.user_id THEN
        INSERT INTO inbox_items (user_id, type, tick_id, comment_id, actor_id)
        VALUES (tick_owner, 'comment', NEW.tick_id, NEW.id, NEW.user_id);
      END IF;

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
