import type { Knex } from "knex";

/**
 * Add comments_count to ticks — denormalized total of all comments on the tick
 * (top-level + all nested replies, since every comment row carries tick_id).
 *
 * Maintained by the ticks_comments_count_sync trigger on comments INSERT/DELETE.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.table("ticks", (t) => {
    t.integer("comments_count").notNullable().defaultTo(0);
  });

  // Resync any existing comments
  await knex.raw(`
    UPDATE ticks SET comments_count = (
      SELECT COUNT(*) FROM comments WHERE tick_id = ticks.id
    )
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION ticks_comments_count_sync()
    RETURNS TRIGGER AS $$
    DECLARE
      target_tick_id UUID;
    BEGIN
      target_tick_id := COALESCE(NEW.tick_id, OLD.tick_id);
      UPDATE ticks
         SET comments_count = (SELECT COUNT(*) FROM comments WHERE tick_id = target_tick_id)
       WHERE id = target_tick_id;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER ticks_comments_count_sync
    AFTER INSERT OR DELETE ON comments
    FOR EACH ROW EXECUTE FUNCTION ticks_comments_count_sync();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP TRIGGER IF EXISTS ticks_comments_count_sync ON comments`);
  await knex.raw(`DROP FUNCTION IF EXISTS ticks_comments_count_sync()`);
  await knex.schema.table("ticks", (t) => {
    t.dropColumn("comments_count");
  });
}
