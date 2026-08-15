import type { Knex } from "knex";

/**
 * Adds an attempt counter to session_images so a failed banner can retry
 * itself without retrying forever.
 *
 * Image generation fails transiently — a malformed response from the gateway,
 * an upstream 5xx — and the original design had no way back from that: the
 * row sat at 'failed' and every later page view rendered nothing. Counting
 * attempts lets a failed row be re-claimed on the next visit while capping how
 * much inference a genuinely broken session can burn.
 *
 * Existing rows start at 1 (they have had exactly one attempt), so a
 * previously failed session gets its retries from here.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("session_images", (t) => {
    t.integer("attempts").notNullable().defaultTo(0);
  });

  await knex("session_images").update({ attempts: 1 });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("session_images", (t) => {
    t.dropColumn("attempts");
  });
}
