import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("log_entries", (t) => {
    t.uuid("id").primary().defaultTo(knex.fn.uuid());
    t.uuid("session_id").notNullable().references("id").inTable("sessions").onDelete("CASCADE");
    t.uuid("climb_id").notNullable().references("id").inTable("climbs").onDelete("CASCADE");
    t.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.date("date").notNullable();
    t.integer("attempts").notNullable().defaultTo(1);
    t.boolean("sent").notNullable().defaultTo(false);
    t.text("notes").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("log_entries");
}
