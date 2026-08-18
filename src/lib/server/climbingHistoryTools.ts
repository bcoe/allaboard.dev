/**
 * The tools the climbing-history agent uses to ground itself in real data.
 *
 * Every tool is **bound to one climber at construction time**. The model never
 * supplies a user id and cannot ask about anyone else — the closure over
 * `userId` is the authorization boundary, not a validated argument, because an
 * argument is something a prompt injection can talk the model into changing.
 *
 * Each tool opens a `gen_ai.execute_tool` span so the calls show up in Sentry's
 * AI Agents dashboards alongside the model spans the AI SDK emits.
 *
 * Server-only. Never imported by client code.
 */

import * as Sentry from "@sentry/nextjs";
import { tool } from "ai";
import { z } from "zod";
import db from "@/lib/server/db";
import { ALL_GRADES } from "@/lib/utils";

/**
 * Row ceiling for a single tool call.
 *
 * The agent is told to ask for months or years at a time, so the windows are
 * wide by design; this only stops a pathological range from putting a decade of
 * ticks into the context window. A truncated result says so, so the model can
 * narrow its range rather than quietly reasoning about a partial corpus.
 */
const MAX_ROWS = 400;

/** ISO date (YYYY-MM-DD), the only date shape the tools accept. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/**
 * Runs a tool body inside a `gen_ai.execute_tool` span.
 *
 * The AI SDK emits its own `ai.toolCall` spans, but Sentry's AI Agents module
 * keys off the `gen_ai.*` convention: `op: "gen_ai.execute_tool"`, a name of
 * `execute_tool <name>`, and `gen_ai.tool.name`. Without those the calls show up
 * as anonymous work under the agent span instead of as tool invocations.
 */
async function inToolSpan<T>(
  name: string,
  description: string,
  input: Record<string, unknown>,
  body: () => Promise<T>,
): Promise<T> {
  return Sentry.startSpan(
    {
      name: `execute_tool ${name}`,
      op: "gen_ai.execute_tool",
      attributes: {
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": name,
        "gen_ai.tool.type": "function",
        "gen_ai.tool.description": description,
        "gen_ai.tool.input": JSON.stringify(input),
      },
    },
    async (span) => {
      const result = await body();
      // Row counts rather than the rows themselves: the useful thing to see in a
      // trace is whether a tool came back empty, not a screenful of ticks.
      const size = Array.isArray(result) ? result.length : undefined;
      if (size !== undefined) span.setAttribute("gen_ai.tool.output.rows", size);
      return result;
    },
  );
}

/** Where a grade sits on the V-scale, for ordering and averaging. */
function gradeRank(grade: string | null | undefined): number {
  if (!grade) return -1;
  return ALL_GRADES.indexOf(grade as (typeof ALL_GRADES)[number]);
}

/**
 * Builds the tool set for one climber.
 *
 * @param userId - The authenticated climber's handle. Every query is filtered
 *   by it; nothing the model says can widen that.
 */
export function climbingHistoryTools(userId: string) {
  return {
    /**
     * The corpus the agent reasons over. Deliberately the widest tool, because
     * the alternative — the model guessing from a summary — is what produces
     * invented climbs.
     */
    listTicks: tool({
      description:
        "List the climber's actual logged ticks (individual climbs) between two dates, " +
        "newest first. Use this whenever a question needs real climbs, grades, notes or " +
        "attempts. Ask for wide ranges — months or a full year at a time.",
      inputSchema: z.object({
        from: isoDate.describe("Start of the range, inclusive (YYYY-MM-DD)."),
        to: isoDate.describe("End of the range, inclusive (YYYY-MM-DD)."),
        sentOnly: z
          .boolean()
          .optional()
          .describe("When true, only climbs the climber actually sent."),
      }),
      execute: async ({ from, to, sentOnly }) =>
        inToolSpan("listTicks", "Real logged ticks in a date range", { from, to, sentOnly }, async () => {
          const rows = await db("ticks as t")
            .join("climbs as c", "t.climb_id", "c.id")
            .leftJoin("boards as b", "c.board_id", "b.id")
            .where("t.user_id", userId)
            .andWhere("t.date", ">=", from)
            .andWhere("t.date", "<=", `${to} 23:59:59`)
            .modify((q) => { if (sentOnly) q.andWhere("t.sent", true) })
            .orderBy("t.date", "desc")
            .limit(MAX_ROWS + 1)
            .select(
              "c.name as climb",
              "c.grade",
              "c.angle",
              "b.name as board",
              "t.sent",
              "t.attempts",
              "t.rating",
              "t.comment",
              "t.duration_minutes",
              // Formatted in the database rather than sliced off a UTC ISO
              // string: `tick_sessions.date` is a real `date` column, and a
              // client-side UTC slice can land a day either side of it. The
              // agent quotes these dates back to the climber, so two tools
              // disagreeing about which day a climb happened is a real bug.
              db.raw("to_char(t.date, 'YYYY-MM-DD') as day"),
            );

          const truncated = rows.length > MAX_ROWS;
          return {
            from,
            to,
            count: Math.min(rows.length, MAX_ROWS),
            truncated,
            note: truncated
              ? `Only the ${MAX_ROWS} most recent ticks in this range are shown. Narrow the range for full coverage.`
              : undefined,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ticks: rows.slice(0, MAX_ROWS).map((r: any) => ({
              climb: r.climb,
              grade: r.grade,
              board: r.board ?? undefined,
              angle: r.angle ?? undefined,
              sent: r.sent,
              attempts: r.attempts ?? undefined,
              rating: r.rating ?? undefined,
              notes: r.comment ?? undefined,
              minutesOnIt: r.duration_minutes ?? undefined,
              date: r.day,
            })),
          };
        }),
    }),

    /**
     * Sessions rather than climbs — the right grain for "what days am I
     * strongest on" and for spotting cycles.
     */
    listSessions: tool({
      description:
        "List the climber's real climbing sessions between two dates: date, day of week, " +
        "how many climbs, how many sent, hardest grade sent, and minutes on the wall. " +
        "Use this for questions about frequency, rest patterns, cycles, or day-of-week form.",
      inputSchema: z.object({
        from: isoDate.describe("Start of the range, inclusive (YYYY-MM-DD)."),
        to: isoDate.describe("End of the range, inclusive (YYYY-MM-DD)."),
      }),
      execute: async ({ from, to }) =>
        inToolSpan("listSessions", "Real climbing sessions in a date range", { from, to }, async () => {
          const rows = await db("tick_sessions")
            .where({ user_id: userId })
            .andWhere("date", ">=", from)
            .andWhere("date", "<=", to)
            .orderBy("date", "desc")
            .limit(MAX_ROWS)
            .select(
              "id", "tick_count", "sent_count", "hardest_grade", "total_minutes",
              db.raw("to_char(date, 'YYYY-MM-DD') as day"),
              db.raw("trim(to_char(date, 'Day')) as day_of_week"),
            );

          return {
            from,
            to,
            count: rows.length,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sessions: rows.map((r: any) => ({
              sessionId: r.id,
              date: r.day,
              dayOfWeek: r.day_of_week,
              climbs: r.tick_count,
              sent: r.sent_count,
              hardestGradeSent: r.hardest_grade ?? undefined,
              minutes: r.total_minutes ?? undefined,
            })),
          };
        }),
    }),

    /**
     * Month-by-month hardest-and-volume summary — the series a trajectory
     * question needs, pre-aggregated so the model is not asked to do arithmetic
     * over hundreds of rows.
     */
    gradeProgression: tool({
      description:
        "Month-by-month summary of the climber's real history: hardest grade sent, number " +
        "of sends, number of attempts, and sessions. Use this for trajectory, progression " +
        "and plateau questions before speculating about future grades.",
      inputSchema: z.object({
        months: z
          .number()
          .int()
          .min(1)
          .max(36)
          .describe("How many months back from today to summarise."),
      }),
      execute: async ({ months }) =>
        inToolSpan("gradeProgression", "Monthly progression summary", { months }, async () => {
          const rows = await db("ticks as t")
            .join("climbs as c", "t.climb_id", "c.id")
            .where("t.user_id", userId)
            .andWhereRaw("t.date >= (now() - (? || ' months')::interval)", [months])
            .select("c.grade", "t.sent", db.raw("to_char(t.date, 'YYYY-MM-DD') as day"));

          const buckets = new Map<
            string,
            { sends: number; attempts: number; hardest: string | null; days: Set<string> }
          >();

          for (const r of rows) {
            const day: string = r.day;
            const month = day.slice(0, 7);
            const bucket = buckets.get(month) ?? { sends: 0, attempts: 0, hardest: null, days: new Set() };
            bucket.days.add(day);
            if (r.sent) {
              bucket.sends += 1;
              if (gradeRank(r.grade) > gradeRank(bucket.hardest)) bucket.hardest = r.grade;
            } else {
              bucket.attempts += 1;
            }
            buckets.set(month, bucket);
          }

          return {
            months,
            series: [...buckets.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([month, b]) => ({
                month,
                hardestGradeSent: b.hardest ?? undefined,
                sends: b.sends,
                unsentAttempts: b.attempts,
                daysClimbing: b.days.size,
              })),
          };
        }),
    }),

    /**
     * The overall shape of the logbook — cheap, and the sensible first call for
     * orienting before asking for ranges.
     */
    historySummary: tool({
      description:
        "Overall summary of the climber's logbook: first and last tick, totals, sends by " +
        "grade, and boards climbed on. Cheap — call this first to orient before requesting " +
        "date ranges.",
      inputSchema: z.object({}),
      execute: async () =>
        inToolSpan("historySummary", "Whole-logbook summary", {}, async () => {
          const [totals] = await db("ticks as t")
            .where("t.user_id", userId)
            .select(
              db.raw("count(*)::int as total_ticks"),
              db.raw("count(*) filter (where t.sent)::int as total_sends"),
              db.raw("min(t.date) as first_tick"),
              db.raw("max(t.date) as last_tick"),
            );

          const byGrade = await db("ticks as t")
            .join("climbs as c", "t.climb_id", "c.id")
            .where("t.user_id", userId)
            .andWhere("t.sent", true)
            .groupBy("c.grade")
            .select("c.grade", db.raw("count(*)::int as sends"));

          const boards = await db("ticks as t")
            .join("climbs as c", "t.climb_id", "c.id")
            .leftJoin("boards as b", "c.board_id", "b.id")
            .where("t.user_id", userId)
            .groupBy("b.name")
            .select("b.name as board", db.raw("count(*)::int as ticks"));

          const iso = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : undefined);

          return {
            totalTicks: totals?.total_ticks ?? 0,
            totalSends: totals?.total_sends ?? 0,
            firstTick: iso(totals?.first_tick),
            lastTick: iso(totals?.last_tick),
            hardestGradeEverSent:
              byGrade.map((g) => g.grade).sort((a, b) => gradeRank(b) - gradeRank(a))[0] ?? undefined,
            sendsByGrade: byGrade
              .sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade))
              .map((g) => ({ grade: g.grade, sends: g.sends })),
            boards: boards
              .filter((b) => b.board)
              .map((b) => ({ board: b.board, ticks: b.ticks })),
          };
        }),
    }),
  };
}
