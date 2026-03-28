import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("users", (t) => {
    t.text("id").primary(); // same as handle
    t.text("handle").notNullable().unique();
    t.text("display_name").notNullable();
    t.text("avatar_color").notNullable().defaultTo("bg-orange-500");
    t.text("bio").notNullable().defaultTo("");
    t.text("home_board").notNullable();
    t.integer("home_board_angle").notNullable().defaultTo(40);
    t.timestamp("joined_at").notNullable().defaultTo(knex.fn.now());
    t.integer("followers_count").notNullable().defaultTo(0);
    t.integer("following_count").notNullable().defaultTo(0);
    t.text("personal_best_kilter").nullable();
    t.text("personal_best_moonboard").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("users");
}
