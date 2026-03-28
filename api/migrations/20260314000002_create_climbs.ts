import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("climbs", (t) => {
    t.uuid("id").primary().defaultTo(knex.fn.uuid());
    t.text("name").notNullable();
    t.text("grade").notNullable();
    t.text("board_type").notNullable();
    t.integer("angle").nullable();
    t.text("description").notNullable().defaultTo("");
    t.text("author").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.text("setter").nullable();
    t.integer("sends").notNullable().defaultTo(0);
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("climbs");
}
