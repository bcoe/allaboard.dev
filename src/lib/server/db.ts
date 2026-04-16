import knex from "knex";
import type { Knex } from "knex";

// Prevent connection pool exhaustion during Next.js dev hot-reloads.
const globalForKnex = global as unknown as { knex?: Knex };

function createDb(): Knex {
  // Route handlers use the pooled URL (PgBouncer) so Vercel functions connect to
  // a warm proxy rather than cold-connecting to Neon over TCP each invocation.
  // DATABASE_URL_UNPOOLED is reserved for knexfile.ts (migrations need advisory locks
  // which break under PgBouncer's transaction mode).
  const connectionString =
    process.env.DATABASE_URL ??
    process.env.DATABASE_URL_UNPOOLED;

  return knex({
    client: "pg",
    connection: connectionString
      ? {
          connectionString,
          ssl: { rejectUnauthorized: false },
        }
      : {
          host: "localhost",
          port: 5432,
          user: process.env.PGUSER ?? process.env.USER,
          database: "allaboard",
        },
    pool: {
      // Vercel functions are ephemeral — don't hold idle connections open.
      // PgBouncer handles the actual connection pool on Neon's side.
      min: 0,
      max: 5,
      idleTimeoutMillis: 10_000,
    },
  });
}

const db = globalForKnex.knex ?? createDb();
if (process.env.NODE_ENV !== "production") globalForKnex.knex = db;

export default db;
