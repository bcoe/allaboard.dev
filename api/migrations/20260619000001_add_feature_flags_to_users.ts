import type { Knex } from "knex";

/**
 * Adds a `feature_flags` JSONB column to users.
 *
 * This is *authored* data (set per-user by an operator or an admin tool), not a
 * value derived from another table, so the denormalization-trigger policy does
 * not apply — there is nothing to keep in sync. The column simply defaults to an
 * empty object so every existing and future user starts with no flags enabled.
 *
 * Shape: a flat object of `{ [flagKey: string]: boolean }`. The canonical list
 * of known keys and their defaults lives in `src/lib/featureFlags.ts`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (t) => {
    t.jsonb("feature_flags").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (t) => {
    t.dropColumn("feature_flags");
  });
}
