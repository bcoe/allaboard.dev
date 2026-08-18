import type { Knex } from "knex";

/**
 * Creates stats_notes — structured notes a climber attaches to a day or a week
 * on their own detailed-stats timeline.
 *
 * `data` is jsonb rather than a wide table of nullable columns, because the five
 * categories have genuinely different shapes: an outdoor route session carries
 * two grades and a pitch count, a strength session carries two variable-length
 * lists, and diet carries a set of flags plus a counter. Modelling that
 * relationally would mean either five tables or a dozen mostly-null columns, and
 * the shapes are never queried individually — a note is always read whole, for
 * one period, to render a card. Validity is enforced at the API boundary by the
 * zod schemas in `src/lib/statsNotes.ts`, which the client shares, so the column
 * being schemaless does not mean the data is unvalidated.
 *
 * This is *source* data, not a derived aggregate, so the denormalization policy
 * (which requires triggers for anything duplicating another table) does not
 * apply — there is nothing here to drift from.
 *
 * **Private.** Unlike everything else in allaboard, these are readable only by
 * their author: a note may record how much someone drank last week. The route
 * handlers return 403 to anyone else, including on GET.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("stats_notes", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");

    // 'day' | 'week'. Kept as text with a check rather than a pg enum so adding
    // a scope later is a migration, not an enum surgery.
    t.text("scope").notNullable();

    // The day itself, or the Monday that starts the week. Storing the Monday
    // means a week note has one canonical key and cannot be filed twice for the
    // same week under different member days.
    t.date("period").notNullable();

    t.text("category").notNullable();
    t.jsonb("data").notNullable().defaultTo("{}");
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    // Every read is "all notes for this user in this period range".
    t.index(["user_id", "scope", "period"], "stats_notes_user_scope_period_idx");
  });

  await knex.raw(`
    ALTER TABLE stats_notes
      ADD CONSTRAINT stats_notes_scope_check CHECK (scope IN ('day', 'week')),
      ADD CONSTRAINT stats_notes_category_check CHECK (category IN (
        'outdoor_climbing', 'outdoor_bouldering', 'strength', 'dietary', 'sleep'
      ))
  `);

  // A week note must be filed against a Monday. Without this a client bug could
  // write the same week twice under two different dates, and the two would never
  // be recognised as the same period again.
  await knex.raw(`
    ALTER TABLE stats_notes
      ADD CONSTRAINT stats_notes_week_is_monday
      CHECK (scope <> 'week' OR EXTRACT(ISODOW FROM period) = 1)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("stats_notes");
}
