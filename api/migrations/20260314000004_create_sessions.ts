import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("sessions", (t) => {
    t.uuid("id").primary().defaultTo(knex.fn.uuid());
    t.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.date("date").notNullable();
    t.text("board_type").notNullable();
    t.integer("angle").notNullable().defaultTo(40);
    t.integer("duration_minutes").notNullable().defaultTo(60);
    t.integer("feel_rating").notNullable().defaultTo(3);
    t.unique(["user_id", "date"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("sessions");
}
