import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("follows", (t) => {
    t.uuid("id").primary().defaultTo(knex.fn.uuid());
    t.text("follower_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.text("following_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.unique(["follower_id", "following_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("follows");
}
