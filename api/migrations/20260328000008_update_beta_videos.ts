import type { Knex } from "knex";

// beta_videos is instagram-only; drop the platform and credit columns
export async function up(knex: Knex): Promise<void> {
  await knex.schema.table("beta_videos", (t) => {
    t.dropColumn("platform");
    t.dropColumn("credit");
    // thumbnail is now nullable — may be absent if oEmbed fetch fails
    t.setNullable("thumbnail");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.table("beta_videos", (t) => {
    t.text("platform").notNullable().defaultTo("instagram");
    t.text("credit").nullable();
    t.dropNullable("thumbnail");
  });
}
