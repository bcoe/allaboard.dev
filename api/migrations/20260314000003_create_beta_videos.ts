import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("beta_videos", (t) => {
    t.increments("id").primary();
    t.uuid("climb_id").notNullable().references("id").inTable("climbs").onDelete("CASCADE");
    t.text("url").notNullable();
    t.text("thumbnail").notNullable();
    t.text("platform").notNullable().defaultTo("instagram");
    t.text("credit").nullable();
    t.integer("sort_order").notNullable().defaultTo(0);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("beta_videos");
}
