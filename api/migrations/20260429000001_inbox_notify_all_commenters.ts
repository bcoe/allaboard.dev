import type { Knex } from "knex";

/**
 * Change the comment inbox trigger from "notify ancestors in this thread" to
 * "notify everyone who has ever commented on this tick".
 *
 * Previous behaviour: notified the tick owner + every author in the ancestor
 * chain above the new comment (walking parent_comment_id up to the root).
 *
 * New behaviour: notified the tick owner + every distinct user who has
 * previously commented anywhere on the same tick, regardless of thread
 * position.  This means posting one comment on a tick subscribes you to all
 * future discussion on it, not just replies in your thread.
 *
 * Dedup guard (notified_users TEXT[]) prevents duplicate rows and
 * self-notification as before.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION inbox_on_comment_insert()
    RETURNS TRIGGER AS $$
    DECLARE
      tick_owner     TEXT;
      notified_users TEXT[] := ARRAY[NEW.user_id::TEXT];
      sub            RECORD;
    BEGIN
      -- Always notify the tick owner (unless they are the commenter)
      SELECT user_id INTO tick_owner FROM ticks WHERE id = NEW.tick_id;
      IF tick_owner IS NOT NULL AND NOT (tick_owner = ANY(notified_users)) THEN
        INSERT INTO inbox_items (user_id, type, tick_id, comment_id, actor_id)
        VALUES (tick_owner, 'comment', NEW.tick_id, NEW.id, NEW.user_id);
        notified_users := notified_users || ARRAY[tick_owner];
      END IF;

      -- Notify every distinct user who has previously commented on this tick
      FOR sub IN
        SELECT DISTINCT user_id
          FROM comments
         WHERE tick_id = NEW.tick_id
           AND id <> NEW.id
      LOOP
        IF NOT (sub.user_id = ANY(notified_users)) THEN
          INSERT INTO inbox_items (user_id, type, tick_id, comment_id, actor_id)
          VALUES (sub.user_id, 'comment', NEW.tick_id, NEW.id, NEW.user_id);
          notified_users := notified_users || ARRAY[sub.user_id];
        END IF;
      END LOOP;

      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Restore migration 004's ancestor-walk behaviour
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
      SELECT user_id INTO tick_owner FROM ticks WHERE id = NEW.tick_id;
      IF tick_owner IS NOT NULL AND NOT (tick_owner = ANY(notified_users)) THEN
        INSERT INTO inbox_items (user_id, type, tick_id, comment_id, actor_id)
        VALUES (tick_owner, 'comment', NEW.tick_id, NEW.id, NEW.user_id);
        notified_users := notified_users || ARRAY[tick_owner];
      END IF;

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
