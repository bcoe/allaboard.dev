import type { Knex } from "knex";

/**
 * Adds an optional per-climb working time to ticks.
 *
 * `duration_minutes` is the number of minutes the climber spent working the
 * climb during the session. It is nullable — null means "no time recorded"
 * (the climber did not track how long they spent on this boulder).
 *
 * Session time totals (see tick_sessions) sum only the recorded durations.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("ticks", (t) => {
    t.integer("duration_minutes").nullable(); // null = no time recorded
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("ticks", (t) => {
    t.dropColumn("duration_minutes");
  });
}
