import type { Knex } from "knex";

/**
 * Creates session_images — one AI-generated header banner per climbing
 * session, keyed by the session's permalink slug.
 *
 * Deliberately a separate table rather than a column on tick_sessions: the
 * tick_sessions_sync trigger rebuilds a user's sessions by DELETE + INSERT on
 * every tick change, so anything stored on that row is destroyed the next time
 * the climber logs a climb. The session slug (`<handle>-YYYY-MM-DD-<n>`) is
 * deterministic and survives those rebuilds, which makes it a stable key here.
 *
 * For that same reason there is no foreign key to tick_sessions — the
 * referenced row is transient. The FK to users (CASCADE) is what cleans these
 * rows up.
 *
 * Image bytes live in `data` (bytea) and are served by
 * `GET /api/tick-sessions/:id/image/raw` with an immutable cache header. The
 * banners are ~200–250 KB JPEGs, comfortably inside Postgres' TOAST handling,
 * and keeping them in the database avoids introducing a blob store for a
 * single feature.
 *
 * `status` doubles as a generation lock: the API claims a job by inserting a
 * 'pending' row with ON CONFLICT DO NOTHING, so two concurrent page views can
 * never both pay for an image.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("session_images", (t) => {
    t.text("session_id").primary();               // tick_sessions slug (no FK — see above)
    t.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.text("status").notNullable();               // 'pending' | 'ready' | 'failed'
    t.text("model").nullable();                   // image model that produced `data`
    t.text("prompt").nullable();                  // the generated image prompt (debugging / regeneration)
    t.text("mime_type").nullable();               // e.g. 'image/jpeg'
    t.binary("data").nullable();                  // image bytes; null until status = 'ready'
    t.text("error").nullable();                   // failure reason when status = 'failed'
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    t.index(["user_id"], "session_images_user_idx");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("session_images");
}
