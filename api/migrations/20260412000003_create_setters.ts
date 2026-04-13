import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("setters", (t) => {
    t.increments("id").primary();
    t.text("name").notNullable().unique();
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
  });

  // Backfill from existing climbs so no setter names are lost
  await knex.raw(`
    INSERT INTO setters (name)
    SELECT DISTINCT trim(setter)
    FROM climbs
    WHERE setter IS NOT NULL AND trim(setter) <> ''
    ON CONFLICT (name) DO NOTHING
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("setters");
}
