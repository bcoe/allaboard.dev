import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("ticks", (t) => {
    t.date("date").nullable(); // nullable for existing rows; new ticks require it
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("ticks", (t) => {
    t.dropColumn("date");
  });
}
