import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("boards", (t) => {
    t.text("type").notNullable().defaultTo("standard");       // 'standard' | 'spray_wall'
    t.text("location").nullable();                             // spray walls only
    t.text("description").nullable();                          // spray walls only
    t.text("created_by").nullable().references("id").inTable("users").onDelete("SET NULL");
  });

  // All pre-seeded boards are standard boards
  await knex("boards").update({ type: "standard" });

  // climbs.angle should be nullable for spray walls
  await knex.schema.alterTable("climbs", (t) => {
    t.integer("angle").nullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("boards", (t) => {
    t.dropColumn("type");
    t.dropColumn("location");
    t.dropColumn("description");
    t.dropColumn("created_by");
  });

  await knex.schema.alterTable("climbs", (t) => {
    t.integer("angle").notNullable().defaultTo(40).alter();
  });
}
