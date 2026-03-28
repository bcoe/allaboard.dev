/**
 * Data access layer.
 *
 * Currently backed by localStorage for local development.
 * To switch to Postgres: create `./postgres.ts` implementing the same exports
 * and update this re-export line. No other files need to change.
 */
export * from "./remote";
