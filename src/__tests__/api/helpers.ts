/**
 * Shared test helpers for API route handler tests.
 * Not a test file itself — imported by the *.test.ts files in this directory.
 */

/**
 * Returns a chainable Knex query-builder stub that is also thenable.
 *
 * Awaiting the stub itself resolves to `arrayResult` (mimics `await db("table")…`).
 * Calling `.first()` resolves to `firstResult`, which defaults to the first element
 * of `arrayResult` (for arrays) or `arrayResult` itself (for a single object /
 * undefined).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function qb(arrayResult: unknown = [], firstResult?: unknown): Record<string, any> {
  const first =
    firstResult !== undefined
      ? firstResult
      : Array.isArray(arrayResult)
      ? (arrayResult as unknown[])[0]
      : arrayResult;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: Record<string, any> = {};

  for (const m of [
    "where", "whereIn", "whereILike", "whereNotNull", "whereNot", "whereRaw",
    "join", "leftJoin", "orderBy", "orderByRaw", "limit", "offset",
    "select", "onConflict", "ignore", "distinct", "as", "insert",
    // aggregate modifiers — return `this` so the whole QB is then awaited
    "avg", "count",
    // .returning("*") used in insert chains (Postgres); resolves via QB's `then`
    "returning",
  ]) {
    b[m] = jest.fn().mockReturnThis();
  }

  b.update    = jest.fn().mockResolvedValue(1);
  b.delete    = jest.fn().mockResolvedValue(1);
  b.increment = jest.fn().mockResolvedValue(1);
  b.decrement = jest.fn().mockResolvedValue(1);
  b.first     = jest.fn().mockResolvedValue(first);

  // Thenable — lets `await db("t")…` resolve without an explicit `.first()` call
  b.then    = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(arrayResult).then(res, rej);
  b.catch   = (fn: (e: unknown) => unknown) => Promise.resolve(arrayResult).catch(fn);
  b.finally = (fn: () => void) => Promise.resolve(arrayResult).finally(fn);

  return b;
}

/** Session that has no auth at all */
export const unauthSession = () =>
  ({ userId: undefined, oauthAccountId: undefined, save: jest.fn() });

/** Session for a fully-authenticated user */
export const authSession = (userId = "testuser") =>
  ({ userId, oauthAccountId: "oauth-1", save: jest.fn() });
