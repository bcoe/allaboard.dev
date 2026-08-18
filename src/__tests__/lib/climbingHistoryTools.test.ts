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
  for (const m of ["join", "leftJoin", "orderBy", "limit", "select", "groupBy", "modify", "andWhereRaw"]) {
    q[m] = jest.fn((...a: unknown[]) => { if (m === "modify") (a[0] as (x: unknown) => void)(q); return q });
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
