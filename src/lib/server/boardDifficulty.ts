/**
 * Board relative difficulty calculation using a per-user logistic regression model.
 *
 * Algorithm overview:
 * 1. Find climbers with ≥5 sessions on ≥2 different boards.
 * 2. For each qualifying climber, build one Bernoulli observation per climbing
 *    attempt across all qualifying boards.  Feature vector per observation:
 *      [grade_norm, board_2_indicator, …, board_n_indicator]
 *    where grade_norm = grade_idx / 18 (continuous, 0–1) and board indicators are
 *    one-hot with the first qualifying board as the reference (all zeros).
 *    - Sent tick, k attempts   → (k−1) fail rows + 1 success row
 *    - Unsent tick, k attempts → k fail rows
 * 3. Fit per-user logistic regression:
 *      logit(P(send)) = β₀ + β_grade · grade_norm + Σ β_board_i · board_indicator_i
 *    The board coefficients capture each board's difficulty relative to the reference
 *    board, controlling for grade.  A more-negative β_board means a lower per-attempt
 *    send probability at any given grade — i.e. a harder board.
 * 4. Convert to per-climber difficulty scores:
 *    - difficulty_raw = −β_board_i  (reference board always has raw = 0 by definition)
 *    - Normalise across the climber's qualifying boards: hardest → 1.0, easiest → 0.0
 * 5. Average each board's normalised scores across climbers.
 * 6. Store as 1.0 + avg so the range is [1.0, 2.0]:
 *    easiest board → 1.0, hardest board → 2.0.
 */

import db from "@/lib/server/db";

// ── Grade index mapping ───────────────────────────────────────────────────────

const GRADE_IDX: Record<string, number> = {
  V0: 0, V1: 1, V2: 2, V3: 3, V4: 4,
  "V5": 5, "V5+": 5.5, V6: 6, V7: 7, V8: 8, "V8+": 8.5,
  V9: 9, V10: 10, V11: 11, V12: 12, V13: 13,
  V14: 14, V15: 15, V16: 16, V17: 17, V18: 18,
};

const MAX_GRADE_IDX = 18;

// ── Logistic regression helpers ───────────────────────────────────────────────

function sigmoid(x: number): number {
  // clamp to avoid numerical overflow
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
}

/**
 * Gradient-descent logistic regression.
 * @param X  n × d feature matrix (no bias column; added internally)
 * @param y  n binary labels {0, 1}
 * @returns  weight vector of length d+1 (bias first)
 */
function fitLogistic(
  X: number[][],
  y: number[],
  iters = 1500,
  lr = 0.05,
): number[] {
  const n = X.length;
  if (n === 0) return [];
  const d = X[0].length;
  const w = new Array(d + 1).fill(0.0);

  for (let it = 0; it < iters; it++) {
    const g = new Array(d + 1).fill(0.0);
    for (let i = 0; i < n; i++) {
      const xi = [1, ...X[i]];
      const pred = sigmoid(xi.reduce((s, v, j) => s + v * w[j], 0));
      const err = (pred - y[i]) / n;
      for (let j = 0; j <= d; j++) g[j] += err * xi[j];
    }
    for (let j = 0; j <= d; j++) w[j] -= lr * g[j];
  }
  return w;
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface DifficultyResult {
  lines: string[];
  boardScores: Record<string, number>; // boardId → new relative_difficulty value
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_SESSIONS_PER_BOARD = 5;
const MIN_QUALIFYING_BOARDS = 2;
/** Cap individual attempt expansion so one outlier tick can't dominate. */
const MAX_ATTEMPTS_EXPAND = 20;

// ── Main function ─────────────────────────────────────────────────────────────

export async function recalculateBoardDifficulty(): Promise<DifficultyResult> {
  const lines: string[] = [];
  const log = (msg: string) => lines.push(msg);

  log("=== Board Relative Difficulty Calculation ===");
  log(`Timestamp: ${new Date().toISOString()}`);
  log("");

  // ── Step 1: Count distinct sessions per (user, board) ────────────────────
  // A "session" is a single calendar day on which at least one tick was logged.
  const sessionRows = await db("ticks")
    .join("climbs", "ticks.climb_id", "climbs.id")
    .join("boards", "climbs.board_id", "boards.id")
    .whereNotNull("ticks.date")
    .whereNotNull("climbs.board_id")
    .select(
      "ticks.user_id",
      "climbs.board_id",
      "boards.name as board_name",
      db.raw("COUNT(DISTINCT DATE(ticks.date))::integer as session_count"),
    )
    .groupBy("ticks.user_id", "climbs.board_id", "boards.name");

  type BoardSummary = { boardId: string; boardName: string; sessionCount: number };
  const userBoardMap = new Map<string, BoardSummary[]>();

  for (const row of sessionRows) {
    if (!userBoardMap.has(row.user_id)) userBoardMap.set(row.user_id, []);
    userBoardMap.get(row.user_id)!.push({
      boardId: row.board_id,
      boardName: row.board_name,
      sessionCount: Number(row.session_count),
    });
  }

  const qualifyingUsers: Array<{ userId: string; qualifyingBoards: BoardSummary[] }> = [];
  for (const [userId, boards] of userBoardMap) {
    const qual = boards.filter(b => b.sessionCount >= MIN_SESSIONS_PER_BOARD);
    if (qual.length >= MIN_QUALIFYING_BOARDS) qualifyingUsers.push({ userId, qualifyingBoards: qual });
  }

  log("Step 1: Session analysis");
  log(`  Users with tick data: ${userBoardMap.size}`);
  log(`  Qualifying climbers (${MIN_SESSIONS_PER_BOARD}+ sessions on ${MIN_QUALIFYING_BOARDS}+ boards): ${qualifyingUsers.length}`);
  log("");

  if (qualifyingUsers.length === 0) {
    log("No qualifying climbers found. Board relative difficulty scores are unchanged.");
    return { lines, boardScores: {} };
  }

  // ── Step 2: Load tick data for qualifying users ───────────────────────────
  const qualIds = qualifyingUsers.map(u => u.userId);

  const tickRows = await db("ticks")
    .join("climbs", "ticks.climb_id", "climbs.id")
    .whereIn("ticks.user_id", qualIds)
    .whereNotNull("ticks.attempts")
    .whereNotNull("climbs.board_id")
    .whereNotNull("climbs.grade")
    .where(db.raw("ticks.attempts::integer"), ">", 0)
    .select(
      "ticks.user_id",
      "climbs.board_id",
      "climbs.grade",
      db.raw("ticks.sent::boolean as sent"),
      db.raw("ticks.attempts::integer as attempts"),
    );

  // Index: userId → boardId → grade → Tick[]
  type TickObs = { attempts: number; sent: boolean };
  const tickIndex = new Map<string, Map<string, Map<string, TickObs[]>>>();

  for (const row of tickRows) {
    if (GRADE_IDX[row.grade] === undefined) continue;
    if (!tickIndex.has(row.user_id)) tickIndex.set(row.user_id, new Map());
    const byBoard = tickIndex.get(row.user_id)!;
    if (!byBoard.has(row.board_id)) byBoard.set(row.board_id, new Map());
    const byGrade = byBoard.get(row.board_id)!;
    if (!byGrade.has(row.grade)) byGrade.set(row.grade, []);
    byGrade.get(row.grade)!.push({ attempts: Number(row.attempts), sent: Boolean(row.sent) });
  }

  // ── Step 3: Per-climber analysis ──────────────────────────────────────────
  // For each qualifying climber, fit a logistic regression across all their ticks
  // on all qualifying boards. Grade is included as a continuous feature so the board
  // coefficients represent difficulty controlling for grade — not confounded with the
  // grade distribution a climber happens to attempt on each board.
  const boardScoreAccum = new Map<string, number[]>(); // boardId → [per-user normalised scores]

  for (const { userId, qualifyingBoards } of qualifyingUsers) {
    log(`─── Climber: ${userId}`);
    log("  Qualifying boards:");
    for (const b of qualifyingBoards) log(`    ${b.boardName}: ${b.sessionCount} sessions`);

    const userTicks = tickIndex.get(userId);
    if (!userTicks) {
      log("  No tick data with attempts recorded. Skipping.\n");
      continue;
    }

    // Build training data.
    // Feature vector: [grade_norm, board_2_indicator, …, board_n_indicator]
    //   grade_norm = grade_idx / MAX_GRADE_IDX  (continuous, scaled to 0–1)
    //   board indicators: one-hot; qualifyingBoards[0] is the reference (all zeros).
    const boardIds = qualifyingBoards.map(b => b.boardId);
    const otherIds = boardIds.slice(1);

    const X: number[][] = [];
    const y: number[] = [];
    const boardsWithObs = new Set<string>();

    for (const { boardId } of qualifyingBoards) {
      const bt = userTicks.get(boardId);
      if (!bt) continue;
      const boardFeatures = otherIds.map(bid => (boardId === bid ? 1 : 0));

      for (const [grade, ticks] of bt) {
        const gIdx = GRADE_IDX[grade];
        if (gIdx === undefined) continue;
        const gradeNorm = gIdx / MAX_GRADE_IDX;

        for (const tick of ticks) {
          const k = Math.min(tick.attempts, MAX_ATTEMPTS_EXPAND);
          boardsWithObs.add(boardId);
          if (tick.sent) {
            for (let i = 0; i < k - 1; i++) { X.push([gradeNorm, ...boardFeatures]); y.push(0); }
            X.push([gradeNorm, ...boardFeatures]); y.push(1);
          } else {
            for (let i = 0; i < k; i++) { X.push([gradeNorm, ...boardFeatures]); y.push(0); }
          }
        }
      }
    }

    log(`  Training logistic regression on ${y.length} attempt observations…`);

    if (boardsWithObs.size < 2 || X.length < 4 || new Set(y).size < 2) {
      log("  Insufficient data for regression. Skipping.\n");
      continue;
    }

    // w = [β₀, β_grade, β_board_2, …, β_board_n]
    // A negative β_board_i means board i yields a lower per-attempt send probability
    // at any given grade compared to the reference board — i.e. it is harder.
    const w = fitLogistic(X, y);
    log(`  Model weights: β₀=${w[0].toFixed(4)}, β_grade=${w[1].toFixed(4)}`);
    otherIds.forEach((bid, i) => {
      const bname = qualifyingBoards.find(b => b.boardId === bid)?.boardName ?? bid;
      log(`    β_board[${bname}]=${w[i + 2].toFixed(4)}`);
    });

    // Convert to difficulty: negate board coefficients so harder boards → larger values.
    // The reference board has implicit β = 0, so its raw difficulty is always 0.
    const difficultyRaw = new Map<string, number>();
    if (boardsWithObs.has(boardIds[0])) {
      difficultyRaw.set(boardIds[0], 0.0);
    }
    otherIds.forEach((bid, i) => {
      if (boardsWithObs.has(bid)) {
        difficultyRaw.set(bid, -(w[i + 2]));
      }
    });

    if (difficultyRaw.size < 2) {
      log("  Fewer than 2 boards with usable tick data. Skipping.\n");
      continue;
    }

    const vals = [...difficultyRaw.values()];
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);

    if (maxV === minV) {
      log("  All boards estimate equal difficulty. Skipping normalization.\n");
      continue;
    }

    log(`  Normalised difficulty scores (raw = −β_board):`);
    for (const [boardId, raw] of difficultyRaw) {
      const score = (raw - minV) / (maxV - minV);
      const bname = qualifyingBoards.find(b => b.boardId === boardId)?.boardName ?? boardId;
      log(`    ${bname}: raw=${raw.toFixed(4)} → normalised=${score.toFixed(4)}`);
      if (!boardScoreAccum.has(boardId)) boardScoreAccum.set(boardId, []);
      boardScoreAccum.get(boardId)!.push(score);
    }
    log("");
  }

  // ── Step 4: Average per board and write to DB ─────────────────────────────
  // The per-climber normalised scores are in [0, 1].  The final value stored is
  // 1.0 + avg so the range is [1.0, 2.0]: the easiest board gets 1.0 (climbers
  // still earn points) and the hardest board gets 2.0.
  log("=== Final Board Scores (range 1.0 – 2.0) ===");
  const allBoards = await db("boards").select("id", "name");
  const boardScores: Record<string, number> = {};

  for (const board of allBoards) {
    const scores = boardScoreAccum.get(board.id);
    if (!scores || scores.length === 0) {
      log(`${board.name}: no qualifying data — score unchanged`);
      continue;
    }
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    boardScores[board.id] = 1.0 + avg;
    log(`${board.name}: ${boardScores[board.id].toFixed(4)}  (from ${scores.length} climber${scores.length !== 1 ? "s" : ""})`);
  }

  if (Object.keys(boardScores).length > 0) {
    log("");
    log("Writing scores to database…");
    for (const [boardId, score] of Object.entries(boardScores)) {
      await db("boards").where({ id: boardId }).update({ relative_difficulty: score });
      log(`  ${boardId} → ${score.toFixed(4)}`);
    }
  }

  log("");
  log("Done.");
  return { lines, boardScores };
}
