import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("comments", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("tick_id").notNullable().references("id").inTable("ticks").onDelete("CASCADE");
    t.text("user_id").notNullable().references("id").inTable("users");
    t.uuid("parent_comment_id").nullable().references("id").inTable("comments").onDelete("CASCADE");
    t.text("body").notNullable();
    t.timestamp("created_at").defaultTo(knex.fn.now());
  });

  await knex.raw(`CREATE INDEX ON comments(tick_id)`);
  await knex.raw(`CREATE INDEX ON comments(parent_comment_id)`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("comments");
}
