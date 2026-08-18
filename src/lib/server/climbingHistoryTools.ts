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
import { CATEGORY_LABELS, YDS_GRADES, summariseNote, type StatsNote } from "@/lib/statsNotes";

/**
 * Row ceiling for a single tool call.
 *
 * The agent is told to ask for months or years at a time, so the windows are
 * wide by design; this only stops a pathological range from putting a decade of
 * ticks into the context window. A truncated result says so, so the model can
 * narrow its range rather than quietly reasoning about a partial corpus.
 */
const MAX_ROWS = 400;

/**
 * A send's difficulty-adjusted score, in SQL.
 *
 * Deliberately the *same* expression the points trigger uses
 * (`api/migrations/20260412000002_add_points_to_users.ts`) rather than a second
 * scale invented for the agent: `ROUND(base × flash bonus × relative_difficulty)`,
 * where `base = ROUND(10 × 1.3^grade)` via the `grade_base_points()` SQL helper.
 *
 * This is what lets the agent compare across boards. `boards.relative_difficulty`
 * runs 1.00 (easiest) to 2.00 (hardest), fitted by logistic regression on real
 * per-attempt send rates, so a V8 on Moonboard 2016 (82 × 2.00 = 164) genuinely
 * outscores a V10 on the Kilter Board (138 × 1.00 = 138). Comparing raw V-grades
 * across boards is the mistake this exists to prevent.
 *
 * Zero for an unsent tick, matching the app: points are awarded for sends.
 */
const ADJUSTED_POINTS_SQL = `
  CASE WHEN t.sent THEN
    CASE WHEN t.attempts = 1
      THEN ROUND((grade_base_points(c.grade) + ROUND(grade_base_points(c.grade) * 0.2))
                 * COALESCE(b.relative_difficulty, 1.0))
      ELSE ROUND(grade_base_points(c.grade) * COALESCE(b.relative_difficulty, 1.0))
    END
  ELSE 0 END`;

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

/** Where an outdoor route grade sits on the YDS scale. Separate scale, separate order. */
function ydsRank(grade: string | null | undefined): number {
  if (!grade) return -1;
  return (YDS_GRADES as readonly string[]).indexOf(grade);
}

/** The hardest of a set of grades on a given scale, or undefined if empty. */
function hardestOn(
  grades: (string | undefined)[],
  rank: (g?: string | null) => number,
): string | undefined {
  return grades.filter(Boolean).sort((a, b) => rank(b) - rank(a))[0];
}

/** A note row as the tools read it. */
interface NoteRow {
  scope: "day" | "week";
  period: string;
  category: StatsNote["category"];
  data: Record<string, unknown>;
}

/** Reads the climber's notes in a period range, oldest first. */
async function fetchNotes(
  userId: string,
  from: string,
  to: string,
  scope?: "day" | "week",
): Promise<NoteRow[]> {
  const rows = await db("stats_notes")
    .where({ user_id: userId })
    .modify((q) => { if (scope) q.where({ scope }) })
    .andWhere("period", ">=", from)
    .andWhere("period", "<=", to)
    .orderBy("period", "asc")
    .limit(MAX_ROWS)
    .select(
      "scope",
      "category",
      "data",
      db.raw("to_char(period, 'YYYY-MM-DD') as period"),
    );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((r: any) => ({
    scope: r.scope,
    period: r.period,
    category: r.category,
    data: r.data ?? {},
  }));
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
        "attempts. Ask for wide ranges — months or a full year at a time. Each tick also " +
        "carries boardDifficulty (1.00 easiest to 2.00 hardest) and adjustedPoints, the " +
        "board-weighted score — use adjustedPoints, never the raw grade, to compare or " +
        "rank climbs done on different boards.",
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
              db.raw("COALESCE(b.relative_difficulty, 1.0)::float as board_difficulty"),
              db.raw(`${ADJUSTED_POINTS_SQL}::int as adjusted_points`),
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
              boardDifficulty: r.board_difficulty,
              adjustedPoints: r.adjusted_points,
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
        "Month-by-month summary of the climber's real history: hardest grade sent, best " +
        "board-adjusted send (with the climb and board that earned it), total adjusted " +
        "points, sends, attempts and days climbing. Use this for trajectory, progression " +
        "and plateau questions before speculating about future grades. Judge progression " +
        "on the adjusted figures — a climber moving from the Kilter Board to a Moonboard " +
        "can get stronger while their raw grades appear to fall.",
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
            .leftJoin("boards as b", "c.board_id", "b.id")
            .select(
              "c.grade",
              "t.sent",
              "c.name as climb",
              "b.name as board",
              db.raw("to_char(t.date, 'YYYY-MM-DD') as day"),
              db.raw("COALESCE(b.relative_difficulty, 1.0)::float as board_difficulty"),
              db.raw(`${ADJUSTED_POINTS_SQL}::int as adjusted_points`),
            );

          interface Bucket {
            sends: number;
            attempts: number;
            hardest: string | null;
            adjustedTotal: number;
            best: { points: number; climb: string; grade: string; board?: string } | null;
            days: Set<string>;
          }
          const buckets = new Map<string, Bucket>();

          for (const r of rows) {
            const day: string = r.day;
            const month = day.slice(0, 7);
            const bucket: Bucket =
              buckets.get(month) ??
              { sends: 0, attempts: 0, hardest: null, adjustedTotal: 0, best: null, days: new Set() };
            bucket.days.add(day);

            if (r.sent) {
              bucket.sends += 1;
              bucket.adjustedTotal += r.adjusted_points ?? 0;
              if (gradeRank(r.grade) > gradeRank(bucket.hardest)) bucket.hardest = r.grade;
              // Best *adjusted* send, which is not always the hardest grade —
              // that difference is the whole point of tracking it.
              if (!bucket.best || (r.adjusted_points ?? 0) > bucket.best.points) {
                bucket.best = {
                  points: r.adjusted_points ?? 0,
                  climb: r.climb,
                  grade: r.grade,
                  board: r.board ?? undefined,
                };
              }
            } else {
              bucket.attempts += 1;
            }
            buckets.set(month, bucket);
          }

          return {
            months,
            scoring:
              "adjustedPoints = grade points x board relative_difficulty (1.00 easiest - 2.00 hardest). " +
              "Compare months on the adjusted figures, not the raw grade.",
            series: [...buckets.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([month, b]) => ({
                month,
                hardestGradeSent: b.hardest ?? undefined,
                bestAdjustedSend: b.best ?? undefined,
                adjustedPointsTotal: b.adjustedTotal,
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
        "grade, the best board-adjusted send, and every board climbed on with its relative " +
        "difficulty. Cheap — call this first to orient before requesting date ranges.",
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
            .groupBy("b.name", "b.relative_difficulty")
            .select(
              "b.name as board",
              db.raw("count(*)::int as ticks"),
              db.raw("COALESCE(b.relative_difficulty, 1.0)::float as relative_difficulty"),
            );

          // The best send once the board is accounted for — frequently a
          // different climb from the hardest raw grade, which is exactly the
          // comparison the agent is here to get right.
          const [best] = await db("ticks as t")
            .join("climbs as c", "t.climb_id", "c.id")
            .leftJoin("boards as b", "c.board_id", "b.id")
            .where("t.user_id", userId)
            .andWhere("t.sent", true)
            .orderByRaw(`${ADJUSTED_POINTS_SQL} desc nulls last`)
            .limit(1)
            .select(
              "c.name as climb",
              "c.grade",
              "b.name as board",
              db.raw("COALESCE(b.relative_difficulty, 1.0)::float as board_difficulty"),
              db.raw(`${ADJUSTED_POINTS_SQL}::int as adjusted_points`),
              db.raw("to_char(t.date, 'YYYY-MM-DD') as day"),
            );

          const iso = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : undefined);

          return {
            totalTicks: totals?.total_ticks ?? 0,
            totalSends: totals?.total_sends ?? 0,
            firstTick: iso(totals?.first_tick),
            lastTick: iso(totals?.last_tick),
            hardestGradeEverSent:
              byGrade.map((g) => g.grade).sort((a, b) => gradeRank(b) - gradeRank(a))[0] ?? undefined,
            // Hardest *raw* grade and best *adjusted* send are reported side by
            // side on purpose: when they disagree, that disagreement is the
            // interesting fact about this climber.
            bestAdjustedSend: best
              ? {
                  climb: best.climb,
                  grade: best.grade,
                  board: best.board ?? undefined,
                  boardDifficulty: best.board_difficulty,
                  adjustedPoints: best.adjusted_points,
                  date: best.day,
                }
              : undefined,
            sendsByGrade: byGrade
              .sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade))
              .map((g) => ({ grade: g.grade, sends: g.sends })),
            boards: boards
              .filter((b) => b.board)
              .map((b) => ({
                board: b.board,
                ticks: b.ticks,
                relativeDifficulty: b.relative_difficulty,
              })),
          };
        }),
    }),
    /**
     * The climber's own notes — the context the board data cannot supply.
     *
     * Notes are what explain a logbook rather than just describe it: a month of
     * thin board training reads as detraining until you see the outdoor sessions
     * next to it. They also carry the things a tick never will — sleep, diet,
     * strength work — which is where most day-of-week and cycle answers actually
     * live.
     *
     * Private, like every other tool here: bound to the session's climber, who is
     * the only person these are ever shown to.
     */
    listNotes: tool({
      description:
        "The climber's own notes in a date range: outdoor climbing and bouldering " +
        "sessions, strength sessions, dietary notes and sleep notes. Day notes " +
        "describe one day, week notes describe a whole week. Use these for context " +
        "the board data cannot give — why a quiet training month was quiet, how " +
        "sleep or drinking lines up with form, whether strength work is happening. " +
        "Ask for months at a time.",
      inputSchema: z.object({
        from: isoDate.describe("Start of the range, inclusive (YYYY-MM-DD)."),
        to: isoDate.describe("End of the range, inclusive (YYYY-MM-DD)."),
        scope: z
          .enum(["day", "week"])
          .optional()
          .describe("Limit to day notes or week notes. Omit for both."),
        category: z
          .enum(["outdoor_climbing", "outdoor_bouldering", "strength", "dietary", "sleep"])
          .optional()
          .describe("Limit to one kind of note. Omit for all."),
      }),
      execute: async ({ from, to, scope, category }) =>
        inToolSpan("listNotes", "The climber's own day and week notes", { from, to, scope, category }, async () => {
          const all = await fetchNotes(userId, from, to, scope);
          const notes = category ? all.filter((n) => n.category === category) : all;

          return {
            from,
            to,
            count: notes.length,
            legend:
              "scope 'day' describes that date; scope 'week' describes the week " +
              "beginning on that date (a Monday). Outdoor grades are YDS for routes " +
              "and V-scale for boulders — a different scale from the board climbs.",
            notes: notes.map((n) => ({
              date: n.period,
              scope: n.scope,
              kind: CATEGORY_LABELS[n.category],
              category: n.category,
              // A readable line plus the raw fields, so the model can quote it or
              // do arithmetic on it without re-deriving either.
              summary: summariseNote({
                id: "", createdAt: "", scope: n.scope, period: n.period,
                category: n.category, data: n.data,
              }),
              ...n.data,
            })),
          };
        }),
    }),

    /**
     * Notes rolled up by month — the series a "do you see any cycles" question
     * needs, without asking the model to tally hundreds of rows.
     */
    notesSummary: tool({
      description:
        "Month-by-month rollup of the climber's notes: outdoor climbing and " +
        "bouldering days, pitches, hardest outdoor grades, strength days, alcoholic " +
        "drinks logged, and how often they reported sleeping well or badly. Use this " +
        "for cycles, training-load and lifestyle-versus-form questions before " +
        "reaching for individual notes.",
      inputSchema: z.object({
        months: z
          .number()
          .int()
          .min(1)
          .max(36)
          .describe("How many months back from today to summarise."),
      }),
      execute: async ({ months }) =>
        inToolSpan("notesSummary", "Monthly rollup of notes", { months }, async () => {
          const to = new Date();
          const from = new Date(to);
          from.setMonth(from.getMonth() - months);
          const iso = (d: Date) => d.toISOString().slice(0, 10);

          const notes = await fetchNotes(userId, iso(from), iso(to));

          interface Bucket {
            outdoorClimbingDays: Set<string>;
            outdoorBoulderingDays: Set<string>;
            strengthDays: Set<string>;
            pitches: number;
            routeGrades: (string | undefined)[];
            boulderGrades: (string | undefined)[];
            /** Kept apart: a daily and a weekly total would double-count. */
            drinksLoggedDaily: number;
            drinksLoggedWeekly: number;
            sleptWell: number;
            sleptBadly: number;
            flags: Map<string, number>;
          }
          const empty = (): Bucket => ({
            outdoorClimbingDays: new Set(), outdoorBoulderingDays: new Set(),
            strengthDays: new Set(), pitches: 0, routeGrades: [], boulderGrades: [],
            drinksLoggedDaily: 0, drinksLoggedWeekly: 0,
            sleptWell: 0, sleptBadly: 0, flags: new Map(),
          });

          const buckets = new Map<string, Bucket>();
          for (const n of notes) {
            const month = n.period.slice(0, 7);
            const b = buckets.get(month) ?? empty();
            const d = n.data as Record<string, never>;

            switch (n.category) {
              case "outdoor_climbing":
                b.outdoorClimbingDays.add(n.period);
                b.pitches += Number(d.pitchCount ?? 0);
                b.routeGrades.push(d.hardestRouteSent, d.hardestRouteWorked);
                break;
              case "outdoor_bouldering":
                b.outdoorBoulderingDays.add(n.period);
                b.boulderGrades.push(d.hardestBoulderSent, d.hardestBoulderWorked);
                break;
              case "strength":
                b.strengthDays.add(n.period);
                break;
              case "dietary":
                if (typeof d.drinks === "number") {
                  if (n.scope === "day") b.drinksLoggedDaily += d.drinks;
                  else b.drinksLoggedWeekly += d.drinks;
                }
                for (const f of (d.flags ?? []) as string[]) {
                  b.flags.set(f, (b.flags.get(f) ?? 0) + 1);
                }
                break;
              case "sleep":
                for (const f of (d.flags ?? []) as string[]) {
                  // "Slept well" / "Slept poorly" phrasing differs per scope, so
                  // match on the sentiment rather than the exact string.
                  if (/well/i.test(f)) b.sleptWell++;
                  else b.sleptBadly++;
                  b.flags.set(f, (b.flags.get(f) ?? 0) + 1);
                }
                break;
            }
            buckets.set(month, b);
          }

          return {
            months,
            legend:
              "Daily and weekly drink counts are reported separately because adding " +
              "them would double-count a climber who logs both. Outdoor route grades " +
              "are YDS; outdoor boulder grades are V-scale.",
            series: [...buckets.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([month, b]) => ({
                month,
                outdoorClimbingDays: b.outdoorClimbingDays.size,
                outdoorBoulderingDays: b.outdoorBoulderingDays.size,
                outdoorPitches: b.pitches,
                hardestOutdoorRoute: hardestOn(b.routeGrades, ydsRank),
                hardestOutdoorBoulder: hardestOn(b.boulderGrades, gradeRank),
                strengthDays: b.strengthDays.size,
                drinksLoggedDaily: b.drinksLoggedDaily,
                drinksLoggedWeekly: b.drinksLoggedWeekly,
                sleptWellReports: b.sleptWell,
                sleptBadlyReports: b.sleptBadly,
                otherFlags: Object.fromEntries(b.flags),
              })),
          };
        }),
    }),

    /**
     * The multiplier scale itself.
     *
     * Separate from `historySummary` so the agent can look it up when it needs to
     * *explain* a comparison — the numbers are the justification for saying a V8
     * on one board beat a V10 on another, and an unexplained reweighting reads as
     * the model making things up.
     */
    boardDifficulty: tool({
      description:
        "The relative difficulty multiplier for every board, and how the scale works. " +
        "Call this when comparing achievements across different boards, or when the " +
        "climber asks why one climb counts for more than another.",
      inputSchema: z.object({}),
      execute: async () =>
        inToolSpan("boardDifficulty", "Board relative difficulty multipliers", {}, async () => {
          const rows = await db("boards")
            .whereExists((q) =>
              q
                .select(db.raw("1"))
                .from("climbs as c")
                .join("ticks as t", "t.climb_id", "c.id")
                .where("t.user_id", userId)
                .andWhereRaw("c.board_id = boards.id"),
            )
            .orderBy("relative_difficulty", "desc")
            .select(
              "name",
              db.raw("COALESCE(relative_difficulty, 1.0)::float as relative_difficulty"),
            );

          return {
            scale:
              "relative_difficulty runs from 1.00 (easiest board) to 2.00 (hardest). It is " +
              "fitted by logistic regression on real per-attempt send rates across climbers " +
              "who use more than one board, controlling for grade — so it measures how much " +
              "harder a board plays at the same nominal grade.",
            formula:
              "adjustedPoints = ROUND(gradePoints x relative_difficulty), where " +
              "gradePoints = ROUND(10 x 1.3^gradeIndex), plus 20% when the climb was flashed " +
              "(one attempt). This is the same scoring the app's leaderboard uses.",
            workedExample:
              "V8 on a board at 2.00 scores 82 x 2 = 164; V10 on a board at 1.00 scores 138. " +
              "So the V8 is the bigger achievement despite the lower grade.",
            boardsClimbedOn: rows.map((r) => ({
              board: r.name,
              relativeDifficulty: r.relative_difficulty,
            })),
          };
        }),
    }),
  };
}
