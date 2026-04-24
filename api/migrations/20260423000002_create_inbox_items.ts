import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("inbox_items", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.text("user_id").notNullable().references("id").inTable("users");
    t.text("type").notNullable(); // 'tick' | 'comment'
    t.uuid("tick_id").nullable().references("id").inTable("ticks").onDelete("CASCADE");
    t.uuid("comment_id").nullable().references("id").inTable("comments").onDelete("CASCADE");
    t.text("actor_id").notNullable().references("id").inTable("users");
    t.boolean("read").notNullable().defaultTo(false);
    t.timestamp("created_at").defaultTo(knex.fn.now());
  });

  await knex.raw(`CREATE INDEX ON inbox_items(user_id, read)`);
  await knex.raw(`CREATE INDEX ON inbox_items(tick_id)`);
  await knex.raw(`CREATE INDEX ON inbox_items(comment_id)`);

  // When a tick is inserted: create inbox items for all followers of the tick's author
  await knex.raw(`
    CREATE OR REPLACE FUNCTION inbox_on_tick_insert()
    RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO inbox_items (user_id, type, tick_id, actor_id)
      SELECT f.follower_id, 'tick', NEW.id, NEW.user_id
      FROM follows f
      WHERE f.following_id = NEW.user_id
        AND f.follower_id <> NEW.user_id;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER inbox_tick_insert
    AFTER INSERT ON ticks
    FOR EACH ROW EXECUTE FUNCTION inbox_on_tick_insert();
  `);

  // When a comment is inserted: notify the tick owner (unless they're the commenter)
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

  await knex.raw(`
    CREATE TRIGGER inbox_comment_insert
    AFTER INSERT ON comments
    FOR EACH ROW EXECUTE FUNCTION inbox_on_comment_insert();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP TRIGGER IF EXISTS inbox_comment_insert ON comments;`);
  await knex.raw(`DROP TRIGGER IF EXISTS inbox_tick_insert ON ticks;`);
  await knex.raw(`DROP FUNCTION IF EXISTS inbox_on_comment_insert;`);
  await knex.raw(`DROP FUNCTION IF EXISTS inbox_on_tick_insert;`);
  await knex.schema.dropTableIfExists("inbox_items");
}
