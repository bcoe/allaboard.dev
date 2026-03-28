import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("ticks", (t) => {
    t.uuid("id").primary().defaultTo(knex.fn.uuid());
    t.uuid("climb_id").notNullable().references("id").inTable("climbs").onDelete("CASCADE");
    t.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.text("suggested_grade").nullable();
    t.integer("rating").notNullable();
    t.text("comment").nullable();
    t.text("instagram_url").nullable();
    t.boolean("sent").notNullable().defaultTo(true);
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    t.unique(["climb_id", "user_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("ticks");
}
