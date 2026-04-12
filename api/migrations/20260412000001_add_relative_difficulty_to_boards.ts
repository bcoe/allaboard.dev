import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("boards", (t) => {
    t.decimal("relative_difficulty", 4, 2).notNullable().defaultTo(1.0);
  });

  // Existing boards start at the neutral baseline of 1.0
  await knex("boards").update({ relative_difficulty: 1.0 });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("boards", (t) => {
    t.dropColumn("relative_difficulty");
  });
}
