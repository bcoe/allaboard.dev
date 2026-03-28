import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Add board_id (text, matching boards.id slug) and star_rating
  await knex.schema.table("climbs", (t) => {
    t.text("board_id").nullable().references("id").inTable("boards").onDelete("SET NULL");
    t.decimal("star_rating", 3, 2).nullable();
  });

  // Best-effort migration of existing board_type values → board_id slugs
  await knex.raw(`
    UPDATE climbs SET board_id = 'kilter-original'
    WHERE board_type = 'Kilter'
  `);
  await knex.raw(`
    UPDATE climbs SET board_id = 'moonboard-2016'
    WHERE board_type = 'Moonboard'
  `);

  // Drop the old free-text column
  await knex.schema.table("climbs", (t) => {
    t.dropColumn("board_type");
  });

  // Unique constraint: one climb per (name, angle, grade, board)
  await knex.schema.table("climbs", (t) => {
    t.unique(["name", "angle", "grade", "board_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.table("climbs", (t) => {
    t.dropUnique(["name", "angle", "grade", "board_id"]);
    t.dropColumn("board_id");
    t.dropColumn("star_rating");
    t.text("board_type").notNullable().defaultTo("Kilter");
  });
}
