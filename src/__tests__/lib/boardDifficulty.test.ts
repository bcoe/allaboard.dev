/**
 * @jest-environment node
 *
 * Unit tests for recalculateBoardDifficulty() in src/lib/server/boardDifficulty.ts
 *
 * The function makes four kinds of DB calls (in order):
 *   1. Session-count query  — JOINed ticks/climbs/boards GROUP BY (user, board, date)
 *   2. Tick-data query      — ticks JOIN climbs for qualifying users
 *   3. All-boards query     — boards SELECT id, name
 *   4. Per-board UPDATE     — one call per board whose score changed
 *
 * DB calls 3 and 4 are skipped when there are no qualifying climbers (early return
 * after call 1).  DB call 4 is skipped when no boards end up with a score.
 *
 * Test scenarios:
 *  - No qualifying climbers (below session threshold)
 *  - One climber, 2-board comparison  → one board 1.0, other 2.0
 *  - One climber, 3-board comparison  → middle board between 1 and 2
 *  - Two climbers sharing a common board → averaging logic verified
 *  - Climber with only 1 qualifying board → excluded
 *  - Climber with no sent ticks (no label variance) → excluded
 *  - Log output content
 *  - Lower-grade attempt volume factors into difficulty via grade-controlled regression
 *  - Ticks at grades above those on the other board do not distort board ordering
 */

import { recalculateBoardDifficulty } from "@/lib/server/boardDifficulty";

jest.mock("@/lib/server/db", () => ({ __esModule: true, default: jest.fn() }));

import db from "@/lib/server/db";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = db as jest.MockedFunction<any>;

// ── Extended query-builder stub ───────────────────────────────────────────────
//
// boardDifficulty.ts uses .groupBy() which the shared qb() helper does not
// include, so we define a local extended version here.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function qbEx(arrayResult: unknown = [], firstResult?: unknown): Record<string, any> {
  const first =
    firstResult !== undefined
      ? firstResult
      : Array.isArray(arrayResult)
      ? (arrayResult as unknown[])[0]
      : arrayResult;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: Record<string, any> = {};

  for (const m of [
    "where", "whereIn", "whereNotNull", "whereNot", "whereRaw",
    "join", "leftJoin", "orderBy", "orderByRaw", "limit", "offset",
    "select", "groupBy", "onConflict", "ignore", "distinct", "as",
    "insert", "avg", "count", "returning",
  ]) {
    b[m] = jest.fn().mockReturnThis();
  }

  b.update    = jest.fn().mockResolvedValue(1);
  b.delete    = jest.fn().mockResolvedValue(1);
  b.increment = jest.fn().mockResolvedValue(1);
  b.decrement = jest.fn().mockResolvedValue(1);
  b.first     = jest.fn().mockResolvedValue(first);

  b.then    = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(arrayResult).then(res, rej);
  b.catch   = (fn: (e: unknown) => unknown) => Promise.resolve(arrayResult).catch(fn);
  b.finally = (fn: () => void) => Promise.resolve(arrayResult).finally(fn);

  return b;
}

// ── Fixture helpers ───────────────────────────────────────────────────────────

/** One row from the session-count query (DB call 1). */
function sessionRow(userId: string, boardId: string, boardName: string, count: number) {
  return { user_id: userId, board_id: boardId, board_name: boardName, session_count: count };
}

/** One row from the tick-data query (DB call 2). */
function tickRow(
  userId: string, boardId: string, grade: string, sent: boolean, attempts: number,
) {
  return { user_id: userId, board_id: boardId, grade, sent, attempts };
}

/**
 * Build `count` identical sent tick rows for (user, board, grade) at the given
 * attempt count.  More ticks gives the logistic regression more signal — use at
 * least 3 per (board, grade) to ensure clear directional convergence.
 */
function sentTicks(
  userId: string, boardId: string, grade: string,
  attempts: number, count = 4,
): ReturnType<typeof tickRow>[] {
  return Array.from({ length: count }, () => tickRow(userId, boardId, grade, true, attempts));
}

/** One row from the boards query (DB call 3). */
function boardRow(id: string, name: string) {
  return { id, name };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // db.raw is used for SQL expressions (GROUP BY, type casts); return a stable
  // dummy value so the chained query builder doesn't throw.
  (db as unknown as Record<string, unknown>).raw = jest.fn().mockReturnValue("__raw__");
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("recalculateBoardDifficulty()", () => {

  // ── Disqualification cases ──────────────────────────────────────────────────

  describe("no qualifying climbers", () => {
    it("returns empty boardScores when no user has 5+ sessions on any board", async () => {
      // Alice has 3 and 4 sessions — neither board meets the ≥5 threshold.
      mockDb.mockReturnValueOnce(qbEx([
        sessionRow("alice", "board-a", "Board A", 3),
        sessionRow("alice", "board-b", "Board B", 4),
      ]));

      const { boardScores, lines } = await recalculateBoardDifficulty();

      expect(boardScores).toEqual({});
      expect(lines.some(l => l.includes("No qualifying climbers"))).toBe(true);
      // Only the session-count query fired; no tick query, no boards query.
      expect(mockDb).toHaveBeenCalledTimes(1);
    });

    it("returns empty boardScores when a user has 5+ sessions on only 1 board", async () => {
      // Alice has enough sessions on board-a but not board-b; needs ≥2 qualifying boards.
      mockDb.mockReturnValueOnce(qbEx([
        sessionRow("alice", "board-a", "Board A", 6),
        sessionRow("alice", "board-b", "Board B", 2),
      ]));

      const { boardScores } = await recalculateBoardDifficulty();

      expect(boardScores).toEqual({});
      expect(mockDb).toHaveBeenCalledTimes(1);
    });
  });

  describe("climber excluded mid-analysis", () => {
    it("skips a climber who has no sent ticks on any qualifying board", async () => {
      // alice qualifies by session count but never sends — all labels are 0,
      // so new Set(y).size < 2 and the regression is skipped.
      mockDb
        .mockReturnValueOnce(qbEx([                              // DB 1: sessions
          sessionRow("alice", "board-a", "Board A", 5),
          sessionRow("alice", "board-b", "Board B", 5),
        ]))
        .mockReturnValueOnce(qbEx([                              // DB 2: ticks
          tickRow("alice", "board-a", "V5", false, 3),
          tickRow("alice", "board-a", "V5", false, 5),
          tickRow("alice", "board-b", "V6", false, 4),
          tickRow("alice", "board-b", "V6", false, 2),
        ]))
        .mockReturnValueOnce(qbEx([                              // DB 3: boards
          boardRow("board-a", "Board A"),
          boardRow("board-b", "Board B"),
        ]));

      const { boardScores, lines } = await recalculateBoardDifficulty();

      expect(boardScores).toEqual({});
      expect(lines.some(l => l.includes("Insufficient data"))).toBe(true);
    });
  });

  // ── 2-board comparison, single climber ─────────────────────────────────────

  describe("2-board comparison with one climber", () => {
    /**
     * Seed data for a clear 2-board case:
     *   board-a → easy   (2 attempts per tick on V5)
     *   board-b → harder (10 attempts per tick on V5)
     */
    function setup2Board() {
      mockDb
        .mockReturnValueOnce(qbEx([                              // DB 1: sessions
          sessionRow("alice", "board-a", "Board A", 5),
          sessionRow("alice", "board-b", "Board B", 5),
        ]))
        .mockReturnValueOnce(qbEx([                              // DB 2: ticks
          ...sentTicks("alice", "board-a", "V5", 2),
          ...sentTicks("alice", "board-b", "V5", 10),
        ]))
        .mockReturnValueOnce(qbEx([                              // DB 3: boards
          boardRow("board-a", "Board A"),
          boardRow("board-b", "Board B"),
        ]))
        .mockReturnValueOnce(qbEx())                             // DB 4: update board-a
        .mockReturnValueOnce(qbEx());                            // DB 5: update board-b
    }

    it("assigns 1.0 to the easier board and 2.0 to the harder board", async () => {
      setup2Board();
      const { boardScores } = await recalculateBoardDifficulty();

      // Normalisation: min → exactly 1.0, max → exactly 2.0
      expect(boardScores["board-a"]).toBeCloseTo(1, 5);
      expect(boardScores["board-b"]).toBeCloseTo(2, 5);
    });

    it("produces exactly 2 board score entries", async () => {
      setup2Board();
      const { boardScores } = await recalculateBoardDifficulty();

      expect(Object.keys(boardScores)).toHaveLength(2);
    });

    it("scores are both in [1, 2]", async () => {
      setup2Board();
      const { boardScores } = await recalculateBoardDifficulty();

      for (const score of Object.values(boardScores)) {
        expect(score).toBeGreaterThanOrEqual(1);
        expect(score).toBeLessThanOrEqual(2);
      }
    });

    it("correctly orders boards based on overall per-attempt difficulty", async () => {
      // V4 data: board-a hard (8 att), board-b easy (2 att) — pulls toward inverse ordering.
      // V6 data: board-a easy (2 att), board-b hard (10 att) — stronger signal for correct ordering.
      // The grade-controlled regression weighs both grades; the dominant V6 signal means
      // board-b ends up with a more-negative β_board, scoring higher (harder).
      mockDb
        .mockReturnValueOnce(qbEx([
          sessionRow("alice", "board-a", "Board A", 5),
          sessionRow("alice", "board-b", "Board B", 5),
        ]))
        .mockReturnValueOnce(qbEx([
          ...sentTicks("alice", "board-a", "V4", 8),
          ...sentTicks("alice", "board-b", "V4", 2),
          ...sentTicks("alice", "board-a", "V6", 2),
          ...sentTicks("alice", "board-b", "V6", 10),
        ]))
        .mockReturnValueOnce(qbEx([
          boardRow("board-a", "Board A"),
          boardRow("board-b", "Board B"),
        ]))
        .mockReturnValueOnce(qbEx())
        .mockReturnValueOnce(qbEx());

      const { boardScores } = await recalculateBoardDifficulty();

      // board-a is easier at V6 (the dominant signal), so it should score lower
      expect(boardScores["board-a"]).toBeLessThan(boardScores["board-b"]);
    });

    it("writes the computed scores to the database", async () => {
      setup2Board();
      await recalculateBoardDifficulty();

      // DB calls 4 and 5 are the board updates
      const updateCalls = mockDb.mock.calls.slice(3); // skip calls 1-3
      expect(updateCalls).toHaveLength(2);
      // Each update call: db("boards")
      expect(updateCalls[0][0]).toBe("boards");
      expect(updateCalls[1][0]).toBe("boards");
    });
  });

  // ── 3-board comparison, single climber ─────────────────────────────────────

  describe("3-board comparison with one climber", () => {
    /**
     * board-a: 2 attempts/tick (easiest)  → should score 1.0
     * board-b: 6 attempts/tick (middle)   → should score between 1 and 2
     * board-c: 14 attempts/tick (hardest) → should score 2.0
     */
    function setup3Board() {
      mockDb
        .mockReturnValueOnce(qbEx([
          sessionRow("alice", "board-a", "Board A", 5),
          sessionRow("alice", "board-b", "Board B", 5),
          sessionRow("alice", "board-c", "Board C", 5),
        ]))
        .mockReturnValueOnce(qbEx([
          ...sentTicks("alice", "board-a", "V5", 2),
          ...sentTicks("alice", "board-b", "V5", 6),
          ...sentTicks("alice", "board-c", "V5", 14),
        ]))
        .mockReturnValueOnce(qbEx([
          boardRow("board-a", "Board A"),
          boardRow("board-b", "Board B"),
          boardRow("board-c", "Board C"),
        ]))
        .mockReturnValueOnce(qbEx())   // update board-a
        .mockReturnValueOnce(qbEx())   // update board-b
        .mockReturnValueOnce(qbEx());  // update board-c
    }

    it("assigns 1.0 to the easiest and 2.0 to the hardest", async () => {
      setup3Board();
      const { boardScores } = await recalculateBoardDifficulty();

      expect(boardScores["board-a"]).toBeCloseTo(1, 5);
      expect(boardScores["board-c"]).toBeCloseTo(2, 5);
    });

    it("places the middle board strictly between 1 and 2", async () => {
      setup3Board();
      const { boardScores } = await recalculateBoardDifficulty();

      expect(boardScores["board-b"]).toBeGreaterThan(1);
      expect(boardScores["board-b"]).toBeLessThan(2);
    });

    it("preserves strict ordering: board-a < board-b < board-c", async () => {
      setup3Board();
      const { boardScores } = await recalculateBoardDifficulty();

      expect(boardScores["board-a"]).toBeLessThan(boardScores["board-b"]);
      expect(boardScores["board-b"]).toBeLessThan(boardScores["board-c"]);
    });

    it("produces exactly 3 board score entries", async () => {
      setup3Board();
      const { boardScores } = await recalculateBoardDifficulty();

      expect(Object.keys(boardScores)).toHaveLength(3);
    });
  });

  // ── Averaging across two climbers ───────────────────────────────────────────

  describe("averaging across two climbers who share all qualifying boards", () => {
    it("averages the per-climber normalised scores for each board", async () => {
      // Both alice and bob qualify on board-a and board-b.
      // Both find board-a easier, board-b harder.
      // Each contributes 1.0 (board-a) and 2.0 (board-b); average stays 1.0/2.0.
      mockDb
        .mockReturnValueOnce(qbEx([
          sessionRow("alice", "board-a", "Board A", 5),
          sessionRow("alice", "board-b", "Board B", 5),
          sessionRow("bob",   "board-a", "Board A", 6),
          sessionRow("bob",   "board-b", "Board B", 7),
        ]))
        .mockReturnValueOnce(qbEx([
          ...sentTicks("alice", "board-a", "V4", 2),
          ...sentTicks("alice", "board-b", "V4", 9),
          ...sentTicks("bob",   "board-a", "V5", 3),
          ...sentTicks("bob",   "board-b", "V5", 8),
        ]))
        .mockReturnValueOnce(qbEx([
          boardRow("board-a", "Board A"),
          boardRow("board-b", "Board B"),
        ]))
        .mockReturnValueOnce(qbEx())
        .mockReturnValueOnce(qbEx());

      const { boardScores } = await recalculateBoardDifficulty();

      expect(boardScores["board-a"]).toBeCloseTo(1, 5);
      expect(boardScores["board-b"]).toBeCloseTo(2, 5);
    });

    it("excludes a board from a climber's contribution when that climber has no data on it", async () => {
      // alice: board-a (easy V5 2att) vs board-b (hard V5 10att) → board-a=1.0, board-b=2.0
      // bob:   board-b (easy V6 2att) vs board-c (hard V6 10att) → board-b=1.0, board-c=2.0
      //
      // board-b accumulates [1.0 from alice, 0.0 from bob] → per-user norm avg 0.5 → stored 1.5
      // board-a accumulates [0.0 from alice only]           → stored 1.0
      // board-c accumulates [1.0 from bob only]             → stored 2.0
      mockDb
        .mockReturnValueOnce(qbEx([
          sessionRow("alice", "board-a", "Board A", 5),
          sessionRow("alice", "board-b", "Board B", 5),
          sessionRow("bob",   "board-b", "Board B", 6),
          sessionRow("bob",   "board-c", "Board C", 5),
        ]))
        .mockReturnValueOnce(qbEx([
          ...sentTicks("alice", "board-a", "V5", 2),
          ...sentTicks("alice", "board-b", "V5", 10),
          ...sentTicks("bob",   "board-b", "V6", 2),
          ...sentTicks("bob",   "board-c", "V6", 10),
        ]))
        .mockReturnValueOnce(qbEx([
          boardRow("board-a", "Board A"),
          boardRow("board-b", "Board B"),
          boardRow("board-c", "Board C"),
        ]))
        .mockReturnValueOnce(qbEx())   // update board-a
        .mockReturnValueOnce(qbEx())   // update board-b
        .mockReturnValueOnce(qbEx());  // update board-c

      const { boardScores } = await recalculateBoardDifficulty();

      expect(Object.keys(boardScores)).toHaveLength(3);
      expect(boardScores["board-a"]).toBeCloseTo(1, 5);
      expect(boardScores["board-c"]).toBeCloseTo(2, 5);
      // board-b: hardest for alice (norm 1.0) but easiest for bob (norm 0.0) → mean 0.5 → stored 1.5
      expect(boardScores["board-b"]).toBeCloseTo(1.5, 5);
    });

    it("does not count a board that only non-qualifying climbers have data on", async () => {
      // charlie has 4 sessions on board-a (below threshold) and 5 on board-b —
      // only 1 qualifying board, so charlie is excluded entirely.
      // alice alone drives the scores.
      mockDb
        .mockReturnValueOnce(qbEx([
          sessionRow("alice",   "board-a", "Board A", 5),
          sessionRow("alice",   "board-b", "Board B", 5),
          sessionRow("charlie", "board-a", "Board A", 4),  // below threshold
          sessionRow("charlie", "board-b", "Board B", 5),
        ]))
        .mockReturnValueOnce(qbEx([
          ...sentTicks("alice", "board-a", "V5", 2),
          ...sentTicks("alice", "board-b", "V5", 9),
          // charlie's ticks are in the DB result but charlie was excluded in JS,
          // so her data never enters the logistic regression
          ...sentTicks("charlie", "board-a", "V5", 5),
          ...sentTicks("charlie", "board-b", "V5", 5),
        ]))
        .mockReturnValueOnce(qbEx([
          boardRow("board-a", "Board A"),
          boardRow("board-b", "Board B"),
        ]))
        .mockReturnValueOnce(qbEx())
        .mockReturnValueOnce(qbEx());

      const { boardScores } = await recalculateBoardDifficulty();

      // Result driven by alice alone — same as the single-climber case
      expect(boardScores["board-a"]).toBeCloseTo(1, 5);
      expect(boardScores["board-b"]).toBeCloseTo(2, 5);
    });
  });

  // ── Log output ──────────────────────────────────────────────────────────────

  describe("log output", () => {
    beforeEach(() => {
      mockDb
        .mockReturnValueOnce(qbEx([
          sessionRow("alice", "board-a", "Board A", 5),
          sessionRow("alice", "board-b", "Board B", 5),
        ]))
        .mockReturnValueOnce(qbEx([
          ...sentTicks("alice", "board-a", "V5", 2),
          ...sentTicks("alice", "board-b", "V5", 8),
        ]))
        .mockReturnValueOnce(qbEx([
          boardRow("board-a", "Board A"),
          boardRow("board-b", "Board B"),
        ]))
        .mockReturnValueOnce(qbEx())
        .mockReturnValueOnce(qbEx());
    });

    it("includes the climber handle in the log", async () => {
      const { lines } = await recalculateBoardDifficulty();
      expect(lines.some(l => l.includes("alice"))).toBe(true);
    });

    it("includes both board names in the log", async () => {
      const { lines } = await recalculateBoardDifficulty();
      expect(lines.some(l => l.includes("Board A"))).toBe(true);
      expect(lines.some(l => l.includes("Board B"))).toBe(true);
    });

    it("logs the model grade coefficient", async () => {
      const { lines } = await recalculateBoardDifficulty();
      expect(lines.some(l => l.includes("β_grade"))).toBe(true);
    });

    it("logs the board coefficient for the non-reference board", async () => {
      const { lines } = await recalculateBoardDifficulty();
      expect(lines.some(l => l.includes("β_board[Board B]"))).toBe(true);
    });

    it("includes a Final Scores section and ends with 'Done.'", async () => {
      const { lines } = await recalculateBoardDifficulty();
      expect(lines.some(l => l.includes("Final"))).toBe(true);
      expect(lines[lines.length - 1]).toBe("Done.");
    });
  });

  // ── Grade-controlled regression behaviour ───────────────────────────────────
  //
  // These tests verify that including grade as a covariate correctly separates
  // board difficulty from grade distribution differences between boards.

  describe("grade-controlled regression: lower-grade attempt volume factors into difficulty", () => {
    it("a board with harder lower grades scores higher when target-grade data is equal", async () => {
      // Both boards have identical V5 ticks (3 attempts each, sent).
      // Board-b has much harder V4 ticks (10 attempts vs 1 on board-a).
      // The grade-controlled regression sees board-b as harder overall: its
      // β_board coefficient is more negative, so difficulty_raw is larger.
      mockDb
        .mockReturnValueOnce(qbEx([
          sessionRow("alice", "board-a", "Board A", 5),
          sessionRow("alice", "board-b", "Board B", 5),
        ]))
        .mockReturnValueOnce(qbEx([
          // V4: board-a trivial (1 attempt), board-b grind (10 attempts)
          ...sentTicks("alice", "board-a", "V4", 1),
          ...sentTicks("alice", "board-b", "V4", 10),
          // V5: identical on both boards
          ...sentTicks("alice", "board-a", "V5", 3),
          ...sentTicks("alice", "board-b", "V5", 3),
        ]))
        .mockReturnValueOnce(qbEx([
          boardRow("board-a", "Board A"),
          boardRow("board-b", "Board B"),
        ]))
        .mockReturnValueOnce(qbEx())
        .mockReturnValueOnce(qbEx());

      const { boardScores } = await recalculateBoardDifficulty();

      // board-b is harder per attempt at V4 → more-negative β_board → scores higher
      expect(boardScores["board-b"]).toBeGreaterThan(boardScores["board-a"]);
      expect(boardScores["board-a"]).toBeCloseTo(1, 5);
      expect(boardScores["board-b"]).toBeCloseTo(2, 5);
    });

    it("contributions from multiple lower grades all factor into the regression", async () => {
      // board-a: V3=1att, V4=1att, V5=3att — easy at every grade
      // board-b: V3=5att, V4=5att, V5=3att — harder at lower grades, same at V5
      // Board-b has more failures across all grades → more-negative β_board → harder
      mockDb
        .mockReturnValueOnce(qbEx([
          sessionRow("alice", "board-a", "Board A", 5),
          sessionRow("alice", "board-b", "Board B", 5),
        ]))
        .mockReturnValueOnce(qbEx([
          ...sentTicks("alice", "board-a", "V3", 1),
          ...sentTicks("alice", "board-b", "V3", 5),
          ...sentTicks("alice", "board-a", "V4", 1),
          ...sentTicks("alice", "board-b", "V4", 5),
          ...sentTicks("alice", "board-a", "V5", 3),
          ...sentTicks("alice", "board-b", "V5", 3),
        ]))
        .mockReturnValueOnce(qbEx([
          boardRow("board-a", "Board A"),
          boardRow("board-b", "Board B"),
        ]))
        .mockReturnValueOnce(qbEx())
        .mockReturnValueOnce(qbEx());

      const { boardScores } = await recalculateBoardDifficulty();

      expect(boardScores["board-b"]).toBeGreaterThan(boardScores["board-a"]);
    });
  });

  describe("grade-controlled regression: grade imbalance between boards does not distort ordering", () => {
    it("ticks at grades not shared by the other board do not invert the board ordering", async () => {
      // board-a: V5 easy (2 att) + V8 moderate (3 att — only on board-a)
      // board-b: V5 hard (8 att)
      // The V8 data is only at board-a (reference); its difficulty is absorbed by
      // β_grade and β₀. The board-b coefficient is still estimated from the V5
      // contrast alone, so board-b correctly scores harder than board-a at V5.
      // (3 att per V8 tick keeps β_grade moderate (~−4) so gradient descent
      // converges within the iteration budget.)
      mockDb
        .mockReturnValueOnce(qbEx([
          sessionRow("alice", "board-a", "Board A", 5),
          sessionRow("alice", "board-b", "Board B", 5),
        ]))
        .mockReturnValueOnce(qbEx([
          ...sentTicks("alice", "board-a", "V5", 2),
          ...sentTicks("alice", "board-b", "V5", 8),
          // V8 on board-a only — must not inflate board-a's difficulty score
          ...sentTicks("alice", "board-a", "V8", 3),
        ]))
        .mockReturnValueOnce(qbEx([
          boardRow("board-a", "Board A"),
          boardRow("board-b", "Board B"),
        ]))
        .mockReturnValueOnce(qbEx())
        .mockReturnValueOnce(qbEx());

      const { boardScores } = await recalculateBoardDifficulty();

      // board-b's V5 data (8 att) is harder than board-a's V5 data (2 att);
      // the V8 ticks are at board-a (reference) and only constrain β_grade / β₀,
      // leaving the board-b coefficient correctly negative (harder).
      expect(boardScores["board-a"]).toBeLessThan(boardScores["board-b"]);
      expect(boardScores["board-a"]).toBeCloseTo(1, 5);
      expect(boardScores["board-b"]).toBeCloseTo(2, 5);
    });
  });
});
