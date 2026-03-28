import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.table("ticks", (t) => {
    t.text("instagram_thumbnail").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.table("ticks", (t) => {
    t.dropColumn("instagram_thumbnail");
  });
}
