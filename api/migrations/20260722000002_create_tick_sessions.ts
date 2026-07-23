import type { Knex } from "knex";

/**
 * Creates the tick_sessions table — a denormalized representation of a
 * climber's individual workout sessions, derived entirely from the ticks
 * table.
 *
 * A session is the set of a user's ticks logged within 6 hours of each other
 * (consecutive-gap grouping). The rows in this table are maintained by a
 * trigger on ticks (see the follow-up trigger migration) and must never be
 * written by application code.
 *
 * The primary key is a deterministic, human-readable slug
 * (`<handle>-YYYY-MM-DD-<n>`) so that shareable permalinks stay stable as the
 * row is rebuilt on each tick change.
 *
 * Session membership is defined by the [started_at, ended_at] window rather
 * than a foreign key on ticks — this keeps the ticks table (and its existing
 * climb-stats trigger) untouched, and lets the detail view read live tick
 * data (comments/ratings) without the row going stale.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("tick_sessions", (t) => {
    t.text("id").primary(); // deterministic slug: <handle>-YYYY-MM-DD-<n>
    t.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.date("date").notNullable();                 // calendar day of the first tick
    t.integer("session_number").notNullable();    // 1-based ordinal within `date`
    t.timestamp("started_at").notNullable();       // first tick timestamp
    t.timestamp("ended_at").notNullable();         // last tick timestamp
    t.integer("tick_count").notNullable().defaultTo(0);
    t.integer("sent_count").notNullable().defaultTo(0);
    t.text("hardest_grade").nullable();            // hardest *sent* grade; null if none sent
    t.integer("total_minutes").nullable();         // sum of recorded durations; null if none recorded
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    t.index(["user_id", "date"], "tick_sessions_user_date_idx");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("tick_sessions");
}
