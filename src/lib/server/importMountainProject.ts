/**
 * Turns a Mountain Project tick export into outdoor-session day notes.
 *
 * These are **not** climbs in allaboard. A Mountain Project tick is an outdoor
 * route or boulder on real rock, which has no board, no angle and no place in the
 * climbs table; importing them as climbs would pollute the directory everyone
 * else browses. They are imported as *day notes* instead — external context for
 * how someone's climbing is going, which is exactly what notes are for.
 *
 * One day becomes at most two notes: an Outdoor Climbing Session for that day's
 * roped climbs, and an Outdoor Bouldering Session for its boulders.
 *
 * Pure and server-only — no database access, so the grouping rules can be tested
 * against the real export.
 */

import { YDS_GRADES } from "@/lib/statsNotes";
import { ALL_GRADES } from "@/lib/utils";

/**
 * Columns are resolved by **header name**, not by position.
 *
 * The export's own header row is the contract; positions are not. (The spec for
 * this feature placed Lead Style at column 9, where the real file has "Your
 * Stars" — Lead Style is column 11. Reading by name means a reordered or extended
 * export keeps working rather than silently importing the wrong field.)
 */
const COLUMNS = {
  date: "Date",
  route: "Route",
  rating: "Rating",
  pitches: "Pitches",
  style: "Style",
  leadStyle: "Lead Style",
  routeType: "Route Type",
  /** Mountain Project's own numeric difficulty ordering. */
  ratingCode: "Rating Code",
} as const;

/**
 * Statuses that mean a roped climb was completed.
 *
 * The spec named only `Redpoint`, but the export carries three more successful
 * lead styles — and in the reference file they are 56 of 724 rows. `Onsight` is a
 * *harder* ascent than a redpoint (no falls, no prior beta); treating it as "not
 * sent" would understate the hardest send on 43 separate days. `Pinkpoint`
 * (pre-hung gear) and a lead `Flash` are likewise ascents.
 */
const ROPED_SENT = new Set(["Redpoint", "Onsight", "Flash", "Pinkpoint"]);

/** The one status that means a roped climb was tried but not completed. */
const ROPED_WORKED = new Set(["Fell/Hung"]);

/**
 * Statuses that mean a boulder was completed.
 *
 * Boulders record success in `Style` rather than `Lead Style`, which is always
 * blank for them. `Solo` is included: on a boulder it denotes an ascent, not an
 * attempt.
 */
const BOULDER_SENT = new Set(["Send", "Flash", "Solo"]);

/** Mountain Project's word for a boulder that did not go. */
const BOULDER_WORKED = new Set(["Attempt"]);

/** A note the import intends to create. */
export interface PlannedNote {
  period: string;
  category: "outdoor_climbing" | "outdoor_bouldering";
  data: Record<string, unknown>;
}

/** What a parse produced, including everything it could not use. */
export interface MountainProjectPlan {
  notes: PlannedNote[];
  rowsParsed: number;
  skipped: {
    /** Rows with no usable date. */
    unparsableDate: number;
    /** Rows whose grade could not be mapped onto a scale allaboard stores. */
    unknownGrade: number;
  };
}

/**
 * Parses CSV text, honouring quoted fields.
 *
 * Written out rather than pulled from a dependency because the shape needed here
 * is small and total: quoted fields may contain commas and newlines, and a
 * doubled quote is an escaped one. The export's `Notes` and `Location` columns
 * both contain commas, so a naive `split(",")` silently shifts every later column.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false;
      } else field += c;
      continue;
    }

    if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = "" }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = "" }
    else if (c !== "\r") field += c;
  }

  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows;
}

/**
 * Maps a Mountain Project route grade onto a grade allaboard can store.
 *
 * The export is messier than the YDS list: it carries protection suffixes
 * (`5.8+ PG13`), slash grades (`5.12b/c`) and bare modifiers (`5.10+`, `5.14-`).
 * Each is resolved *downward* — a slash grade takes its lower half, a `+` lands
 * mid-band and a `-` at the bottom — so an import never overstates what someone
 * climbed. Mountain Project's own `Rating Code` confirms the direction: `5.10+`
 * scores 3300, between 5.10c (3200) and 5.10d (3500).
 */
export function normaliseYds(raw: string): string | undefined {
  const cleaned = stripSuffixes(raw);
  if (!cleaned) return undefined;

  // `5.10a/b` → `5.10a`: the lower of the two.
  const base = cleaned.split("/")[0].trim();
  if ((YDS_GRADES as readonly string[]).includes(base)) return base;

  const mod = base.match(/^5\.(\d+)([+-])$/);
  if (mod) {
    const number = Number(mod[1]);
    // Below 5.10 the scale has no letters, so the modifier simply drops.
    if (number < 10) {
      const plain = `5.${number}`;
      return (YDS_GRADES as readonly string[]).includes(plain) ? plain : undefined;
    }
    const letter = mod[2] === "+" ? "c" : "a";
    const withLetter = `5.${number}${letter}`;
    return (YDS_GRADES as readonly string[]).includes(withLetter) ? withLetter : undefined;
  }

  return undefined;
}

/**
 * Maps a Mountain Project boulder grade onto the V-scale allaboard stores.
 *
 * `V5+` and `V8+` are real grades here and kept as-is; every other modifier is
 * dropped to the base grade, since the scale has no `V6+` to store it in.
 */
export function normaliseVScale(raw: string): string | undefined {
  const cleaned = stripSuffixes(raw);
  if (!cleaned) return undefined;
  if ((ALL_GRADES as readonly string[]).includes(cleaned)) return cleaned;

  // `V4-5` → `V4`; `V6+` / `V6-` → `V6`.
  const m = cleaned.match(/^V(\d+)/i);
  if (!m) return undefined;
  const plain = `V${Number(m[1])}`;
  return (ALL_GRADES as readonly string[]).includes(plain) ? plain : undefined;
}

/** Removes protection and quality suffixes: `V7 PG13`, `5.11a R`, `5.12 X`. */
function stripSuffixes(raw: string): string {
  return raw
    .replace(/\s+(PG-?13|R|X)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** One tick, reduced to what the grouping rules need. */
interface Tick {
  date: string;
  isBoulder: boolean;
  pitches: number;
  /** Mountain Project's numeric ordering; the comparator for "hardest". */
  code: number;
  grade: string;
  sent: boolean;
  worked: boolean;
}

/**
 * Reads one CSV row into a tick, or returns null if it cannot be used.
 *
 * A row with an unrecognised status is still a tick: it counts towards the
 * session and its pitches, it just contributes no grade. Only a missing date
 * makes a row unusable, since the date is what the note hangs on.
 */
function toTick(row: string[], col: Record<string, number>): Tick | null {
  const date = (row[col.date] ?? "").trim();
  // Mountain Project exports ISO dates; anything else is not safe to guess at.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const routeType = (row[col.routeType] ?? "").trim();
  const isBoulder = /boulder/i.test(routeType);
  const style = (row[col.style] ?? "").trim();
  const leadStyle = (row[col.leadStyle] ?? "").trim();

  // Boulders record success in Style; roped climbs in Lead Style, falling back to
  // Style for the ones with no lead style at all (a solo, say).
  const status = isBoulder ? style : leadStyle || style;
  const sentSet = isBoulder ? BOULDER_SENT : ROPED_SENT;
  const workedSet = isBoulder ? BOULDER_WORKED : ROPED_WORKED;

  const pitches = Number(row[col.pitches]);
  const code = Number(row[col.ratingCode]);

  return {
    date,
    isBoulder,
    pitches: Number.isFinite(pitches) && pitches > 0 ? pitches : 1,
    // Falls back to 0 so a row with no code still sorts, just last.
    code: Number.isFinite(code) ? code : 0,
    grade: (row[col.rating] ?? "").trim(),
    sent: sentSet.has(status),
    worked: workedSet.has(status),
  };
}

/**
 * Groups an export into the notes it should become.
 *
 * Per day, per kind of climbing:
 *   - **Pitches** are the day's pitch counts added together. Roped climbs and
 *     boulders are counted separately, because they become separate notes.
 *   - **Hardest sent** is the hardest climb the day completed; omitted entirely
 *     if nothing went down, since a blank field says "not recorded" and a guess
 *     would say something false.
 *   - **Hardest worked** is the hardest climb that was tried and did not go.
 *
 * "Hardest" is decided by Mountain Project's `Rating Code`, which is monotonic
 * with difficulty and orders slash grades correctly (`5.10a/b` = 2800 sits
 * between 5.10a = 2600 and 5.10b = 2900). Comparing the grade *strings* would
 * need a parser that already handles every messy variant — the code does it for
 * free and is the exporter's own opinion of the ordering.
 */
export function buildMountainProjectNotes(csv: string): MountainProjectPlan {
  const rows = parseCsv(csv);
  const header = rows[0]?.map((h) => h.trim().replace(/^"|"$/g, "")) ?? [];

  const col = Object.fromEntries(
    Object.entries(COLUMNS).map(([key, name]) => [key, header.indexOf(name)]),
  ) as Record<keyof typeof COLUMNS, number>;

  if (col.date < 0) {
    throw new Error(
      "That file does not look like a Mountain Project export — no 'Date' column in its header row.",
    );
  }

  const skipped = { unparsableDate: 0, unknownGrade: 0 };
  const byDay = new Map<string, { roped: Tick[]; boulders: Tick[] }>();
  let rowsParsed = 0;

  for (const row of rows.slice(1)) {
    // Trailing blank line, or a row too short to be real.
    if (row.every((c) => !c.trim())) continue;

    const tick = toTick(row, col);
    if (!tick) { skipped.unparsableDate++; continue }

    rowsParsed++;
    const day = byDay.get(tick.date) ?? { roped: [], boulders: [] };
    (tick.isBoulder ? day.boulders : day.roped).push(tick);
    byDay.set(tick.date, day);
  }

  const notes: PlannedNote[] = [];

  /** The hardest tick matching `pick`, by Mountain Project's own ordering. */
  const hardest = (ticks: Tick[], pick: (t: Tick) => boolean) =>
    ticks.filter(pick).sort((a, b) => b.code - a.code)[0];

  for (const [date, day] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (day.roped.length) {
      const data: Record<string, unknown> = {
        pitchCount: day.roped.reduce((sum, t) => sum + t.pitches, 0),
      };

      const sent = hardest(day.roped, (t) => t.sent);
      const worked = hardest(day.roped, (t) => t.worked);

      // A grade that will not map is dropped rather than guessed at; the session
      // still gets its note, which is the claim that actually matters.
      if (sent) {
        const g = normaliseYds(sent.grade);
        if (g) data.hardestRouteSent = g; else skipped.unknownGrade++;
      }
      if (worked) {
        const g = normaliseYds(worked.grade);
        if (g) data.hardestRouteWorked = g; else skipped.unknownGrade++;
      }

      notes.push({ period: date, category: "outdoor_climbing", data });
    }

    if (day.boulders.length) {
      const data: Record<string, unknown> = {};

      const sent = hardest(day.boulders, (t) => t.sent);
      const worked = hardest(day.boulders, (t) => t.worked);

      if (sent) {
        const g = normaliseVScale(sent.grade);
        if (g) data.hardestBoulderSent = g; else skipped.unknownGrade++;
      }
      if (worked) {
        const g = normaliseVScale(worked.grade);
        if (g) data.hardestBoulderWorked = g; else skipped.unknownGrade++;
      }

      notes.push({ period: date, category: "outdoor_bouldering", data });
    }
  }

  return { notes, rowsParsed, skipped };
}
