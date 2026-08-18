/**
 * Structured notes a climber can attach to a day or a week on their stats page.
 *
 * The single source of truth for what a note may contain, shared by the dialog
 * that builds one and the route handler that stores one. Keeping the vocabulary
 * in one client-safe module is what stops the two drifting — a dropdown offering
 * an option the server rejects is the classic failure here.
 *
 * Client-safe: no database imports.
 */

import { z } from "zod";
import { ALL_GRADES } from "@/lib/utils";

/** Whether a note is attached to a single day or to a Monday–Sunday week. */
export type NoteScope = "day" | "week";

/**
 * Yosemite Decimal System grades, for outdoor routes.
 *
 * Distinct from the V-scale the boards use, and given exactly as specified —
 * including the bare `5.11` alongside `5.11a`–`5.11d`, since plenty of guidebooks
 * grade that way and a climber should be able to record what the book said.
 */
export const YDS_GRADES = [
  "5.5", "5.6", "5.7", "5.8", "5.9",
  "5.10a", "5.10b", "5.10c", "5.10d",
  "5.11", "5.11a", "5.11b", "5.11c", "5.11d",
  "5.12a", "5.12b", "5.12c", "5.12d",
  "5.13a", "5.13b", "5.13c", "5.13d",
  "5.14a", "5.14b", "5.14c", "5.14d",
  "5.15a", "5.15b", "5.15c", "5.15d",
] as const;

/** Barbell lifts, each recorded with the heaviest weight moved that session. */
export const LIFTS = ["Deadlift", "Squat", "Overhead Press", "Bench Press", "Curl"] as const;

/** Bodyweight exercises. Only the pull-up takes added weight. */
export const EXERCISES = ["Pull-up", "Bent-arm hang", "Push-up"] as const;

/** The exercise that accepts an added-weight figure. */
export const WEIGHTED_EXERCISE = "Pull-up";

/** Dietary observations, split by the scope each one can be stated at. */
export const DIETARY_FLAGS = {
  day: [
    "Healthy snack before climbing",
    "Ate poorly before climbing",
    "High-protein diet",
    "Stayed well hydrated",
  ],
  week: [
    "High-protein diet throughout the week",
    "Brought healthy snacks to the crag",
    "Stayed well hydrated",
  ],
} as const;

/** Sleep observations, likewise scope-specific. */
export const SLEEP_FLAGS = {
  day: ["Slept poorly night before", "Slept well night before"],
  week: ["Had trouble sleeping this week", "Slept well this week"],
} as const;

/** Label for the drinks counter, which reads differently per scope. */
export const DRINKS_LABEL: Record<NoteScope, string> = {
  day: "Drinks today",
  week: "Drinks this week",
};

/**
 * Which categories make sense at which scope.
 *
 * The three session categories describe something that happened on a *day* — an
 * "outdoor bouldering session" spanning a week is not a thing — so they are
 * offered only in the day view. Diet and sleep are the two that genuinely have
 * both a daily and a weekly reading, and the spec gives them separate option
 * lists for each.
 */
export const CATEGORIES_BY_SCOPE = {
  day: ["outdoor_climbing", "outdoor_bouldering", "strength", "dietary", "sleep"],
  week: ["dietary", "sleep"],
} as const;

export const CATEGORY_LABELS: Record<NoteCategory, string> = {
  outdoor_climbing: "Outdoor Climbing Session",
  outdoor_bouldering: "Outdoor Bouldering Session",
  strength: "Strength Session",
  dietary: "Dietary Notes",
  sleep: "Sleep Notes",
};

// ── Payload schemas ───────────────────────────────────────────────────────────

const ydsGrade = z.enum(YDS_GRADES);
const vGrade = z.enum(ALL_GRADES as [string, ...string[]]);

/**
 * Every grade field is optional, including on the bouldering session.
 *
 * The spec marks the route fields optional and leaves the boulder ones bare, but
 * requiring "hardest boulder sent" would make it impossible to log a session
 * where nothing went down — the exact case the route category explicitly allows
 * for. A session with no grades attached still carries its main claim: that the
 * climber was out that day.
 */
export const OUTDOOR_CLIMBING = z.object({
  hardestRouteWorked: ydsGrade.optional(),
  hardestRouteSent: ydsGrade.optional(),
  pitchCount: z.number().int().min(1).max(60).optional(),
});

export const OUTDOOR_BOULDERING = z.object({
  hardestBoulderWorked: vGrade.optional(),
  hardestBoulderSent: vGrade.optional(),
});

export const STRENGTH = z.object({
  lifts: z
    .array(
      z.object({
        lift: z.enum(LIFTS),
        maxWeight: z.number().min(0).max(1000).optional(),
      }),
    )
    .max(LIFTS.length)
    .optional(),
  exercises: z
    .array(
      z.object({
        exercise: z.enum(EXERCISES),
        addedWeight: z.number().min(0).max(500).optional(),
      }),
    )
    .max(EXERCISES.length)
    .optional(),
});

/**
 * Flags are validated against the scope's own list, so a weekly-only observation
 * cannot be filed against a single day (or the reverse).
 */
function flagPayload(byScope: { day: readonly string[]; week: readonly string[] }, scope: NoteScope) {
  return z.object({
    flags: z.array(z.enum(byScope[scope] as [string, ...string[]])).optional(),
  });
}

export const DIETARY = (scope: NoteScope) =>
  flagPayload(DIETARY_FLAGS, scope).extend({
    drinks: z.number().int().min(0).max(100).optional(),
  });

export const SLEEP = (scope: NoteScope) => flagPayload(SLEEP_FLAGS, scope);

export type NoteCategory =
  | "outdoor_climbing"
  | "outdoor_bouldering"
  | "strength"
  | "dietary"
  | "sleep";

/**
 * Validates a note for a given scope.
 *
 * Scope is a parameter rather than part of the union for two reasons: dietary and
 * sleep have scope-dependent option lists, so the same category name means
 * different things on a day and on a week; and the *set of categories* itself
 * differs, since an "outdoor bouldering session" spanning a week is not a thing.
 *
 * Both rules are enforced here rather than only in the dialog's dropdown — a list
 * of options the client happens to render is not validation.
 */
export function noteSchema(scope: NoteScope) {
  const byCategory = {
    outdoor_climbing: () => z.object({ category: z.literal("outdoor_climbing"), data: OUTDOOR_CLIMBING }),
    outdoor_bouldering: () => z.object({ category: z.literal("outdoor_bouldering"), data: OUTDOOR_BOULDERING }),
    strength: () => z.object({ category: z.literal("strength"), data: STRENGTH }),
    dietary: () => z.object({ category: z.literal("dietary"), data: DIETARY(scope) }),
    sleep: () => z.object({ category: z.literal("sleep"), data: SLEEP(scope) }),
  } as const;

  const options = CATEGORIES_BY_SCOPE[scope].map((c) => byCategory[c]());
  return z.discriminatedUnion(
    "category",
    options as unknown as [ReturnType<(typeof byCategory)["sleep"]>, ...z.ZodObject[]],
  );
}

/** A stored note, as the API returns it. */
export interface StatsNote {
  id: string;
  scope: NoteScope;
  /** The day, or the Monday of the week (YYYY-MM-DD). */
  period: string;
  category: NoteCategory;
  data: Record<string, unknown>;
  createdAt: string;
}

// ── Presentation ──────────────────────────────────────────────────────────────

/**
 * One-line summary of a note, for the hover card.
 *
 * Lives here rather than in the component because the hover card and the dialog
 * both need it and they must agree — a note that reads one way on hover and
 * another in the editor is a note you cannot confidently delete.
 */
export function summariseNote(note: StatsNote): string {
  const d = note.data as Record<string, never>;

  switch (note.category) {
    case "outdoor_climbing": {
      const bits: string[] = [];
      if (d.hardestRouteSent) bits.push(`sent ${d.hardestRouteSent}`);
      if (d.hardestRouteWorked) bits.push(`worked ${d.hardestRouteWorked}`);
      if (d.pitchCount) bits.push(`${d.pitchCount} pitches`);
      return bits.length ? bits.join(", ") : "outdoor routes";
    }
    case "outdoor_bouldering": {
      const bits: string[] = [];
      if (d.hardestBoulderSent) bits.push(`sent ${d.hardestBoulderSent}`);
      if (d.hardestBoulderWorked) bits.push(`worked ${d.hardestBoulderWorked}`);
      return bits.length ? bits.join(", ") : "outdoor bouldering";
    }
    case "strength": {
      const lifts = (d.lifts ?? []) as { lift: string; maxWeight?: number }[];
      const exercises = (d.exercises ?? []) as { exercise: string; addedWeight?: number }[];
      const bits = [
        ...lifts.map((l) => (l.maxWeight ? `${l.lift} ${l.maxWeight}` : l.lift)),
        ...exercises.map((e) =>
          e.addedWeight ? `${e.exercise} +${e.addedWeight}` : e.exercise,
        ),
      ];
      return bits.length ? bits.join(", ") : "strength session";
    }
    case "dietary": {
      const flags = (d.flags ?? []) as string[];
      const bits = [...flags];
      if (typeof d.drinks === "number") {
        bits.push(`${DRINKS_LABEL[note.scope].toLowerCase()}: ${d.drinks}`);
      }
      return bits.length ? bits.join(", ") : "dietary note";
    }
    case "sleep": {
      const flags = (d.flags ?? []) as string[];
      return flags.length ? flags.join(", ") : "sleep note";
    }
  }
}
