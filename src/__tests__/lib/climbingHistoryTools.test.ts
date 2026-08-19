/**
 * @jest-environment node
 *
 * The agent's tools — the only route by which it learns anything true.
 *
 * The agent is told never to invent a climb, but a rule in a system prompt is a
 * request, not a guarantee. What actually keeps it honest is these tools: every
 * query is filtered to one climber, every date range is real, and a result that
 * had to be truncated says so rather than passing off a partial corpus as the
 * whole record.
 */

jest.mock("@/lib/server/db", () => {
  const fn = jest.fn();
  Object.assign(fn, { fn: { now: () => "now()" }, raw: (sql: string, b?: unknown) => ({ __raw: sql, b }) });
  return { __esModule: true, default: fn };
});
jest.mock("@sentry/nextjs", () => {
  const spans: Record<string, unknown>[] = [];
  return {
    __esModule: true,
    __spans: spans,
    startSpan: (options: Record<string, unknown>, cb: (s: unknown) => unknown) => {
      spans.push(options);
      return cb({ setAttribute: () => {}, setStatus: () => {}, end: () => {} });
    },
  };
});

import db from "@/lib/server/db";
import * as SentryMock from "@sentry/nextjs";
import { climbingHistoryTools } from "@/lib/server/climbingHistoryTools";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = db as jest.MockedFunction<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const spans = (SentryMock as any).__spans as Record<string, unknown>[];

/** A chainable query stub that resolves to `rows`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function qb(rows: unknown[]): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: Record<string, any> = { __where: [] as unknown[][] };
  for (const m of [
    "join", "leftJoin", "orderBy", "orderByRaw", "limit", "select", "from",
    "groupBy", "modify", "andWhereRaw", "whereExists",
  ]) {
    q[m] = jest.fn((...a: unknown[]) => {
      // `modify` and `whereExists` both hand a builder to a callback.
      if (m === "modify" || m === "whereExists") (a[0] as (x: unknown) => void)(q);
      return q;
    });
  }
  for (const m of ["where", "andWhere"]) {
    q[m] = jest.fn((...a: unknown[]) => { q.__where.push(a); return q });
  }
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(res, rej);
  return q;
}

const tickRow = {
  climb: "argh", grade: "V6", angle: 40, board: "Kilter Board (Original)",
  sent: true, attempts: 12, rating: 4, comment: "What a triumph.",
  duration_minutes: 40, day: "2026-07-23",
  board_difficulty: 1, adjusted_points: 47,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tools = () => climbingHistoryTools("alice") as any;

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.mockReset();
  spans.length = 0;
});

describe("tool authorization", () => {
  it("filters ticks to the climber the tools were built for", async () => {
    // Not a validated argument — a closure. There is no parameter for "whose
    // history", so nothing the model says can point these at another climber.
    const q = qb([tickRow]);
    mockDb.mockReturnValue(q);

    await tools().listTicks.execute({ from: "2026-01-01", to: "2026-12-31" });

    expect(q.__where).toContainEqual(["t.user_id", "alice"]);
  });

  it("filters sessions to the same climber", async () => {
    const q = qb([]);
    mockDb.mockReturnValue(q);

    await tools().listSessions.execute({ from: "2026-01-01", to: "2026-12-31" });

    expect(q.__where).toContainEqual([{ user_id: "alice" }]);
  });

  it("exposes no tool that takes a user id", () => {
    // A tool that accepted one would be an authorization hole dressed as an API.
    for (const [name, t] of Object.entries(tools())) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const keys = Object.keys((t as any).inputSchema?.shape ?? {});
      expect(keys.join(",")).not.toMatch(/user|handle|climber/i);
      expect(name).toBeTruthy();
    }
  });
});

describe("grounding", () => {
  it("returns the climber's real ticks, dated as the database dates them", async () => {
    mockDb.mockReturnValue(qb([tickRow]));

    const out = await tools().listTicks.execute({ from: "2026-01-01", to: "2026-12-31" });

    expect(out.count).toBe(1);
    expect(out.ticks[0]).toMatchObject({
      climb: "argh", grade: "V6", sent: true, notes: "What a triumph.",
      // Formatted by Postgres, so it cannot disagree with a session's date by a
      // day — the agent quotes these back to the climber.
      date: "2026-07-23",
    });
  });

  it("says so when a range was truncated rather than implying full coverage", async () => {
    // Reasoning about a silently partial corpus is how a wrong "hardest ever"
    // gets stated with confidence.
    mockDb.mockReturnValue(qb(Array.from({ length: 401 }, () => tickRow)));

    const out = await tools().listTicks.execute({ from: "2020-01-01", to: "2026-12-31" });

    expect(out.truncated).toBe(true);
    expect(out.count).toBe(400);
    expect(out.note).toMatch(/narrow the range/i);
  });

  it("rejects a date that is not a real ISO date", async () => {
    const parsed = tools().listTicks.inputSchema.safeParse({ from: "last March", to: "2026-12-31" });
    expect(parsed.success).toBe(false);
  });

  it("caps how far back a progression summary may reach", async () => {
    expect(tools().gradeProgression.inputSchema.safeParse({ months: 12 }).success).toBe(true);
    expect(tools().gradeProgression.inputSchema.safeParse({ months: 600 }).success).toBe(false);
  });
});

describe("tool telemetry", () => {
  it("opens a gen_ai.execute_tool span per call, as Sentry's AI dashboards expect", async () => {
    mockDb.mockReturnValue(qb([tickRow]));

    await tools().listTicks.execute({ from: "2026-01-01", to: "2026-12-31" });

    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      name: "execute_tool listTicks",
      op: "gen_ai.execute_tool",
      attributes: expect.objectContaining({
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": "listTicks",
        "gen_ai.tool.type": "function",
      }),
    });
  });

  it("records the tool's input on the span", async () => {
    mockDb.mockReturnValue(qb([]));

    await tools().listSessions.execute({ from: "2026-01-01", to: "2026-06-30" });

    const attrs = spans[0].attributes as Record<string, unknown>;
    expect(JSON.parse(attrs["gen_ai.tool.input"] as string)).toMatchObject({
      from: "2026-01-01",
      to: "2026-06-30",
    });
  });
});

// ── Board difficulty weighting ────────────────────────────────────────────────
//
// A V8 is not a V8. Boards differ enormously at the same nominal grade, so every
// cross-board comparison has to go through `relative_difficulty` — and the agent
// can only do that if the tools hand it the weighted figures. Raw grades alone
// make a climber who moved to a harder board look like they regressed.

describe("board difficulty weighting", () => {
  it("carries the board multiplier and adjusted score on every tick", async () => {
    mockDb.mockReturnValue(
      qb([{ ...tickRow, board: "Moonboard 2016", grade: "V8", board_difficulty: 2, adjusted_points: 164 }]),
    );

    const out = await tools().listTicks.execute({ from: "2026-01-01", to: "2026-12-31" });

    expect(out.ticks[0]).toMatchObject({
      grade: "V8",
      board: "Moonboard 2016",
      boardDifficulty: 2,
      // 82 x 2.00 — which outranks a V10 on a 1.00 board (138).
      adjustedPoints: 164,
    });
  });

  it("scores with the app's own points formula, not a second one", async () => {
    // Reusing grade_base_points() in SQL is what keeps the agent's arithmetic and
    // the leaderboard's from drifting apart.
    const q = qb([tickRow]);
    mockDb.mockReturnValue(q);

    await tools().listTicks.execute({ from: "2026-01-01", to: "2026-12-31" });

    const sql = q.select.mock.calls.flat().map((c: unknown) => JSON.stringify(c)).join(" ");
    expect(sql).toContain("grade_base_points");
    expect(sql).toContain("relative_difficulty");
  });

  it("reports the best adjusted send per month, not just the hardest grade", async () => {
    // The two disagree exactly when a board switch is involved, and that
    // disagreement is the fact a trajectory answer turns on.
    mockDb.mockReturnValue(
      qb([
        { grade: "V10", sent: true, climb: "Easy Ten", board: "Kilter Board (Original)",
          day: "2026-03-04", board_difficulty: 1, adjusted_points: 138 },
        { grade: "V8", sent: true, climb: "Hard Eight", board: "Moonboard 2016",
          day: "2026-03-11", board_difficulty: 2, adjusted_points: 164 },
      ]),
    );

    const out = await tools().gradeProgression.execute({ months: 12 });
    const march = out.series.find((m: { month: string }) => m.month === "2026-03");

    expect(march.hardestGradeSent).toBe("V10");
    expect(march.bestAdjustedSend).toMatchObject({
      climb: "Hard Eight", grade: "V8", board: "Moonboard 2016", points: 164,
    });
    expect(march.adjustedPointsTotal).toBe(302);
    expect(out.scoring).toMatch(/relative_difficulty/);
  });

  it("explains the scale so a reweighted comparison can be justified", async () => {
    mockDb.mockReturnValue(qb([
      { name: "Moonboard 2016", relative_difficulty: 2 },
      { name: "Kilter Board (Original)", relative_difficulty: 1 },
    ]));

    const out = await tools().boardDifficulty.execute({});

    expect(out.scale).toMatch(/1\.00 \(easiest board\) to 2\.00/);
    expect(out.formula).toMatch(/gradePoints x relative_difficulty/);
    expect(out.workedExample).toMatch(/V8/);
    expect(out.boardsClimbedOn[0]).toEqual({
      board: "Moonboard 2016",
      relativeDifficulty: 2,
    });
  });
});

// ── Notes as agent context ────────────────────────────────────────────────────
//
// A logbook of board climbs is half the picture: a quiet training month reads as
// detraining until the outdoor sessions next to it are visible. These tools are
// what let the agent see the other half — and, like every tool here, they are
// bound to one climber, since notes are private.

// ── Aggregation ───────────────────────────────────────────────────────────────
//
// "Which day do I climb hardest" needs months of history grouped and compared.
// Doing that from raw ticks means tallying hundreds of rows in the model's head —
// slow, and the kind of arithmetic it gets quietly wrong. These tools push the
// grouping into the database and, just as importantly, report how thin each group
// is so a winner is never named off a single session.

describe("aggregation tools", () => {
  /** `db.raw` result shape, for the SQL-side aggregate. */
  const rawRows = (rows: unknown[]) => {
    mockDb.raw = jest.fn().mockResolvedValue({ rows });
    return mockDb.raw;
  };

  it("groups board ticks in SQL rather than returning rows to count", async () => {
    const raw = rawRows([
      { bucket: "Tuesday", sort_key: 2, days: 6, ticks: 12, sends: 9, best_adjusted: 138, mean_adjusted: 90, total_adjusted: 810, hardest_sent: "V10" },
      { bucket: "Thursday", sort_key: 4, days: 7, ticks: 14, sends: 6, best_adjusted: 164, mean_adjusted: 120, total_adjusted: 720, hardest_sent: "V8" },
    ]);

    const out = await tools().aggregateTicks.execute({ groupBy: "day_of_week", months: 12 });

    // One statement, and it is scoped to this climber.
    expect(raw).toHaveBeenCalledTimes(1);
    expect(raw.mock.calls[0][1]).toEqual(["alice", 12]);
    expect(out.groups[0]).toMatchObject({
      group: "Tuesday", daysClimbed: 6, sends: 9, sendRate: 0.75,
      hardestGradeSent: "V10", bestAdjustedPoints: 138,
    });
  });

  it("weights groups by board difficulty so they can be compared at all", async () => {
    const raw = rawRows([]);
    await tools().aggregateTicks.execute({ groupBy: "board", months: 12 });

    const sql = String(raw.mock.calls[0][0]);
    expect(sql).toContain("grade_base_points");
    expect(sql).toContain("relative_difficulty");
  });

  it("lets the database decide the ordering of weekdays", async () => {
    // Alphabetical weekdays would read as nonsense; isodow is the real order.
    const raw = rawRows([]);
    await tools().aggregateTicks.execute({ groupBy: "day_of_week", months: 12 });

    expect(String(raw.mock.calls[0][0])).toContain("isodow");
  });

  it("warns when the groups are too thin to compare", async () => {
    // This climber's actual board history: three sessions on three weekdays. A
    // "strongest day" here would be invented.
    rawRows([
      { bucket: "Tuesday", sort_key: 2, days: 1, ticks: 1, sends: 1, best_adjusted: 22, mean_adjusted: 22, total_adjusted: 22, hardest_sent: "V3" },
      { bucket: "Thursday", sort_key: 4, days: 1, ticks: 2, sends: 1, best_adjusted: 48, mean_adjusted: 48, total_adjusted: 48, hardest_sent: "V6" },
    ]);

    const out = await tools().aggregateTicks.execute({ groupBy: "day_of_week", months: 12 });

    expect(out.sampleSize.sufficientForComparison).toBe(false);
    expect(out.sampleSize.caution).toMatch(/do not name a strongest/i);
  });

  it("says the sample is sufficient once the groups are big enough", async () => {
    rawRows([
      { bucket: "Tuesday", sort_key: 2, days: 9, ticks: 20, sends: 15, best_adjusted: 138, mean_adjusted: 90, total_adjusted: 1350, hardest_sent: "V10" },
      { bucket: "Friday", sort_key: 5, days: 7, ticks: 15, sends: 10, best_adjusted: 106, mean_adjusted: 80, total_adjusted: 800, hardest_sent: "V9" },
    ]);

    const out = await tools().aggregateTicks.execute({ groupBy: "day_of_week", months: 12 });

    expect(out.sampleSize.sufficientForComparison).toBe(true);
    expect(out.sampleSize.caution).toBeUndefined();
  });

  it("groups outdoor days by weekday, in weekday order", async () => {
    // Most climbing happens outside the board, so the same question has to be
    // answerable from the notes.
    mockDb.mockReturnValue(
      qb([
        // 2026-05-04 is a Monday, 2026-05-09 a Saturday.
        { scope: "day", period: "2026-05-04", category: "outdoor_climbing", data: { pitchCount: 4, hardestRouteSent: "5.11d" } },
        { scope: "day", period: "2026-05-11", category: "outdoor_climbing", data: { pitchCount: 2, hardestRouteSent: "5.12a" } },
        { scope: "day", period: "2026-05-09", category: "outdoor_climbing", data: { pitchCount: 6, hardestRouteWorked: "5.13c" } },
      ]),
    );

    const out = await tools().aggregateOutdoorDays.execute({ groupBy: "day_of_week", months: 12 });

    expect(out.groups.map((g: { group: string }) => g.group)).toEqual(["Monday", "Saturday"]);
    const monday = out.groups.find((g: { group: string }) => g.group === "Monday");
    expect(monday).toMatchObject({
      daysOut: 2,
      pitches: 6,
      // Hardest on the YDS scale across both Mondays.
      hardestRouteSent: "5.12a",
      daysWithASend: 2,
    });
  });

  it("keeps outdoor grades on their own scales", async () => {
    mockDb.mockReturnValue(qb([]));
    const out = await tools().aggregateOutdoorDays.execute({ groupBy: "month", months: 12 });

    expect(out.legend).toMatch(/YDS/);
    expect(out.legend).toMatch(/Neither is a board grade/i);
  });

  it("opens gen_ai.execute_tool spans for both aggregates", async () => {
    rawRows([]);
    await tools().aggregateTicks.execute({ groupBy: "month", months: 12 });
    expect(spans[0]).toMatchObject({ op: "gen_ai.execute_tool", name: "execute_tool aggregateTicks" });

    spans.length = 0;
    mockDb.mockReturnValue(qb([]));
    await tools().aggregateOutdoorDays.execute({ groupBy: "month", months: 12 });
    expect(spans[0]).toMatchObject({ op: "gen_ai.execute_tool", name: "execute_tool aggregateOutdoorDays" });
  });
});

describe("note tools", () => {
  const noteRow = (over: Record<string, unknown> = {}) => ({
    scope: "day",
    period: "2026-05-04",
    category: "outdoor_climbing",
    data: { pitchCount: 4, hardestRouteSent: "5.11d" },
    ...over,
  });

  it("filters notes to the climber the tools were built for", async () => {
    const q = qb([noteRow()]);
    mockDb.mockReturnValue(q);

    await tools().listNotes.execute({ from: "2026-01-01", to: "2026-12-31" });

    expect(q.__where).toContainEqual([{ user_id: "alice" }]);
  });

  it("returns a readable summary alongside the raw fields", async () => {
    // The summary is for quoting; the raw fields are for arithmetic. Deriving one
    // from the other in the model's head is how numbers drift.
    mockDb.mockReturnValue(qb([noteRow()]));

    const out = await tools().listNotes.execute({ from: "2026-01-01", to: "2026-12-31" });

    expect(out.notes[0]).toMatchObject({
      date: "2026-05-04",
      scope: "day",
      kind: "Outdoor Climbing Session",
      pitchCount: 4,
      hardestRouteSent: "5.11d",
    });
    expect(out.notes[0].summary).toMatch(/sent 5\.11d/);
  });

  it("says which scale outdoor grades are on", async () => {
    // YDS for routes, V-scale for boulders, and neither belongs in the board's
    // adjusted-points arithmetic.
    mockDb.mockReturnValue(qb([]));

    const out = await tools().listNotes.execute({ from: "2026-01-01", to: "2026-12-31" });

    expect(out.legend).toMatch(/YDS/);
    expect(out.legend).toMatch(/V-scale/);
  });

  it("rolls notes up by month for cycle questions", async () => {
    mockDb.mockReturnValue(
      qb([
        noteRow({ period: "2026-05-04" }),
        noteRow({ period: "2026-05-11", data: { pitchCount: 2, hardestRouteSent: "5.12a" } }),
        noteRow({ period: "2026-05-12", category: "strength", data: {} }),
        noteRow({
          period: "2026-05-13", category: "dietary", data: { drinks: 3, flags: ["Stayed well hydrated"] },
        }),
        noteRow({ period: "2026-05-14", category: "sleep", data: { flags: ["Slept poorly night before"] } }),
        noteRow({
          period: "2026-05-04", category: "outdoor_bouldering", data: { hardestBoulderSent: "V6" },
        }),
      ]),
    );

    const out = await tools().notesSummary.execute({ months: 12 });
    const may = out.series.find((m: { month: string }) => m.month === "2026-05");

    expect(may).toMatchObject({
      outdoorClimbingDays: 2,
      outdoorBoulderingDays: 1,
      outdoorPitches: 6,
      // Hardest on the YDS scale, which orders differently from the V-scale.
      hardestOutdoorRoute: "5.12a",
      hardestOutdoorBoulder: "V6",
      strengthDays: 1,
      drinksLoggedDaily: 3,
      sleptBadlyReports: 1,
    });
  });

  it("keeps daily and weekly drink counts apart", async () => {
    // Adding them would double-count a climber who logs both, and a wrong total
    // is worse than two honest ones.
    mockDb.mockReturnValue(
      qb([
        noteRow({ period: "2026-05-13", category: "dietary", data: { drinks: 2 } }),
        noteRow({ scope: "week", period: "2026-05-11", category: "dietary", data: { drinks: 9 } }),
      ]),
    );

    const out = await tools().notesSummary.execute({ months: 6 });
    const may = out.series.find((m: { month: string }) => m.month === "2026-05");

    expect(may.drinksLoggedDaily).toBe(2);
    expect(may.drinksLoggedWeekly).toBe(9);
    expect(out.legend).toMatch(/double-count/);
  });

  it("recognises a good night's sleep at either scope", async () => {
    // The wording differs per scope ("Slept well night before" vs "Slept well this
    // week"), so the rollup matches on sentiment rather than the exact string.
    mockDb.mockReturnValue(
      qb([
        noteRow({ period: "2026-05-02", category: "sleep", data: { flags: ["Slept well night before"] } }),
        noteRow({ scope: "week", period: "2026-05-04", category: "sleep", data: { flags: ["Slept well this week"] } }),
        noteRow({ period: "2026-05-06", category: "sleep", data: { flags: ["Had trouble sleeping this week"] } }),
      ]),
    );

    const out = await tools().notesSummary.execute({ months: 6 });
    const may = out.series.find((m: { month: string }) => m.month === "2026-05");

    expect(may.sleptWellReports).toBe(2);
    expect(may.sleptBadlyReports).toBe(1);
  });

  it("opens a gen_ai.execute_tool span like every other tool", async () => {
    mockDb.mockReturnValue(qb([]));

    await tools().listNotes.execute({ from: "2026-01-01", to: "2026-12-31" });

    expect(spans[0]).toMatchObject({
      name: "execute_tool listNotes",
      op: "gen_ai.execute_tool",
      attributes: expect.objectContaining({ "gen_ai.tool.name": "listNotes" }),
    });
  });

  it("exposes no note tool that takes a user id", () => {
    for (const name of ["listNotes", "notesSummary"]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const keys = Object.keys((tools() as any)[name].inputSchema?.shape ?? {});
      expect(keys.join(",")).not.toMatch(/user|handle|climber/i);
    }
  });
});
