"use client";

/**
 * Per-column note cards above the sends timeline.
 *
 * One card sits over each column of the chart, aligned to it: in week view a card
 * per week, in day view a card per day. Clicking one opens the editor for *that*
 * period, so the column you are looking at is the period you annotate — no
 * separate date picker to keep in sync with the chart.
 *
 * Week notes and day notes are distinct kinds. A week note describes the whole
 * week; a day note describes that day. The chart's granularity decides which kind
 * you are editing, and:
 *
 *   - **Hover** in week view lists the week's own notes *and* the daily notes
 *     inside it, in two labelled sections. In day view it lists that day's notes.
 *   - **The editor only ever writes the granularity you are viewing.** Weekly
 *     notes are added and deleted from week view, daily from day view. The server
 *     enforces the same rule, so it is not merely visual.
 *
 * Alignment comes from the chart itself — `convertToPixel` on the category axis,
 * recomputed whenever ECharts re-lays out — rather than from CSS that duplicates
 * ECharts' grid maths and drifts out of agreement with it.
 *
 * Only ever rendered for the climber whose page it is; the endpoint is owner-only
 * for reads too, since a note can record how much someone drank.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CATEGORIES_BY_SCOPE,
  CATEGORY_LABELS,
  DIETARY_FLAGS,
  DRINKS_LABEL,
  EXERCISES,
  LIFTS,
  SLEEP_FLAGS,
  WEIGHTED_EXERCISE,
  YDS_GRADES,
  summariseNote,
  type NoteCategory,
  type NoteScope,
  type StatsNote,
} from "@/lib/statsNotes";
import { ALL_GRADES } from "@/lib/utils";
import { createStatsNote, deleteStatsNote, getStatsNotes } from "@/lib/db";

/** Where one chart column sits: centre pixel and width. */
export interface ColumnBox {
  x: number;
  width: number;
}

/** Local YYYY-MM-DD, avoiding the UTC shift `toISOString` would introduce. */
function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The Monday that starts the week containing `date`.
 *
 * Weeks run Monday–Sunday to match the chart's own bucketing, and the database
 * rejects a week note filed against any other weekday — so one week always has
 * exactly one key.
 */
function weekMonday(date: string): string {
  const d = new Date(date + "T00:00:00");
  const shift = (d.getDay() + 6) % 7; // Sunday(0) → 6, Monday(1) → 0
  d.setDate(d.getDate() - shift);
  return localDate(d);
}

/** The Sunday that ends the week starting at `monday`. */
function weekSunday(monday: string): string {
  const d = new Date(monday + "T00:00:00");
  d.setDate(d.getDate() + 6);
  return localDate(d);
}

const prettyDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });

/** How a period reads in a heading, given the scope it was filed at. */
function periodLabel(period: string, scope: NoteScope): string {
  return scope === "week"
    ? `${prettyDate(period)} – ${prettyDate(weekSunday(period))}`
    : prettyDate(period);
}

/** Height of the strip. Generous enough that a 4px-wide day cell is still hittable. */
const STRIP_HEIGHT = 24;

export default function StatsNotesRow({
  handle,
  scope,
  periods,
  columns,
}: {
  handle: string;
  /** The granularity the chart is showing — decides which kind of note is edited. */
  scope: NoteScope;
  /** Bucket keys in chart order: dates in day view, week Mondays in week view. */
  periods: string[];
  /** Pixel geometry per column, parallel to `periods`. */
  columns: ColumnBox[];
}) {
  const [notes, setNotes] = useState<StatsNote[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  // Bumping this refetches. The fetch lives in the effect so the state update
  // lands in an async callback rather than an effect body.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Both scopes in one read: week view needs its daily notes too.
      const all = await getStatsNotes(handle).catch(() => []);
      if (!cancelled) setNotes(all);
    })();
    return () => { cancelled = true };
  }, [handle, reloadKey]);

  /**
   * Notes grouped by the period they belong to at the *current* granularity.
   *
   * In week view a day note is indexed under its week, so it shows up on that
   * week's card — visible in context, still not editable there.
   */
  const byPeriod = useMemo(() => {
    const map = new Map<string, { own: StatsNote[]; days: StatsNote[] }>();
    const bucket = (p: string) => {
      const existing = map.get(p) ?? { own: [], days: [] };
      map.set(p, existing);
      return existing;
    };

    for (const n of notes) {
      if (n.scope === scope) {
        bucket(n.period).own.push(n);
      } else if (scope === "week" && n.scope === "day") {
        bucket(weekMonday(n.period)).days.push(n);
      }
      // Week notes in day view belong to no single day, so they are not shown —
      // switching to Week is how you see them.
    }
    return map;
  }, [notes, scope]);

  const editingNotes = editing
    ? notes.filter((n) => n.scope === scope && n.period === editing)
    : [];

  return (
    <>
      <div className="relative mb-1" style={{ height: STRIP_HEIGHT }}>
        {periods.map((period, i) => {
          const box = columns[i];
          // Until the chart has laid out there is no geometry to align to, and a
          // card in the wrong place is worse than one not yet drawn.
          if (!box) return null;

          const entry = byPeriod.get(period);
          const own = entry?.own.length ?? 0;
          const days = entry?.days.length ?? 0;
          const total = own + days;

          return (
            <button
              key={period}
              onClick={() => setEditing(period)}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered((h) => (h === i ? null : h))}
              title={`Notes — ${periodLabel(period, scope)}`}
              aria-label={`Notes for ${periodLabel(period, scope)}${total ? `, ${total} note${total === 1 ? "" : "s"}` : ""}`}
              className={`absolute top-0 flex items-center justify-center overflow-hidden rounded-[3px] border transition-colors ${
                own > 0
                  ? "border-orange-500 bg-orange-500/70 text-white hover:bg-orange-400"
                  : days > 0
                    // A week whose days carry notes, but which has none of its own:
                    // shown faintly so the week card hints at what is inside it.
                    ? "border-orange-500/40 bg-orange-500/20 text-orange-200 hover:bg-orange-500/40"
                    : "border-stone-700 bg-stone-800/60 text-stone-400 hover:border-orange-500 hover:bg-stone-700 hover:text-orange-400"
              }`}
              style={{
                left: Math.round(box.x - box.width / 2) + 1,
                width: Math.max(3, Math.round(box.width) - 2),
                height: STRIP_HEIGHT - 4,
              }}
            >
              {/*
                A note glyph sitting behind the label, so an empty card still
                reads as "notes go here" rather than as an unexplained cell.
                Deliberately faint — the strip runs the width of the chart and a
                row of solid icons would compete with the data underneath it.

                Only drawn where there is room: a day column in the default
                6-month range is a few pixels wide, and a squeezed glyph is
                noise rather than a hint.
              */}
              {box.width >= 14 && <NoteGlyph />}

              {/* Only wide enough to letter in week view; day cells are slivers. */}
              {box.width >= 22 && total > 0 && (
                <span className="relative text-[0.6rem] font-semibold leading-none text-white">
                  {total}
                </span>
              )}
            </button>
          );
        })}

        {hovered !== null && periods[hovered] && editing === null && (
          <HoverCard
            scope={scope}
            period={periods[hovered]}
            box={columns[hovered]}
            own={byPeriod.get(periods[hovered])?.own ?? []}
            days={byPeriod.get(periods[hovered])?.days ?? []}
          />
        )}
      </div>

      {editing && (
        <NoteDialog
          handle={handle}
          scope={scope}
          period={editing}
          notes={editingNotes}
          onChanged={reload}
          onClose={() => { setEditing(null); setHovered(null) }}
        />
      )}
    </>
  );
}

/**
 * The note mark behind a card's label.
 *
 * `currentColor` at low opacity, so it takes the card's own state — faint stone on
 * an empty column, white on one that carries notes — without a second set of
 * colour rules to keep in step. `aria-hidden` and non-interactive: the button's
 * own label already names the period and its note count.
 */
function NoteGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className="pointer-events-none absolute h-3 w-3 opacity-30"
    >
      <path d="M3 2.5h7.5L13 5v8.5H3z" />
      <path d="M5.5 7h5M5.5 9.5h3" />
    </svg>
  );
}

/**
 * The hover summary for one column.
 *
 * In week view the daily notes get their own labelled section: they belong to the
 * week you are pointing at and are worth seeing, but they are not editable here,
 * and running the two lists together would imply otherwise.
 */
function HoverCard({
  scope, period, box, own, days,
}: {
  scope: NoteScope;
  period: string;
  box?: ColumnBox;
  own: StatsNote[];
  days: StatsNote[];
}) {
  const empty = own.length === 0 && days.length === 0;
  const width = 272;

  return (
    <div
      role="tooltip"
      className="absolute z-30 rounded-xl border border-stone-700 bg-stone-800 p-3 shadow-2xl"
      style={{
        // Centred on the column, then clamped so a card near either edge stays
        // on screen rather than being cut off by the chart container.
        left: Math.max(0, (box?.x ?? 0) - width / 2),
        top: STRIP_HEIGHT + 4,
        width,
      }}
    >
      <p className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wide text-stone-400">
        {periodLabel(period, scope)}
      </p>

      {empty ? (
        <p className="text-xs text-stone-500">No notes yet. Click to add one.</p>
      ) : (
        <div className="space-y-3">
          {own.length > 0 && (
            <Section title={scope === "week" ? "This week" : "This day"} notes={own} />
          )}
          {days.length > 0 && <Section title="Days this week" notes={days} withDates />}
        </div>
      )}
    </div>
  );
}

function Section({
  title, notes, withDates = false,
}: {
  title: string;
  notes: StatsNote[];
  withDates?: boolean;
}) {
  return (
    <div>
      <p className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-stone-500">
        {title}
      </p>
      <ul className="space-y-1">
        {notes.map((n) => (
          <li key={n.id} className="text-xs text-stone-300">
            <span className="text-orange-400">{CATEGORY_LABELS[n.category]}</span>
            {withDates && (
              <span className="text-stone-500">
                {" "}· {new Date(n.period + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" })}
              </span>
            )}
            <span className="text-stone-400"> — {summariseNote(n)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The editor.
 *
 * A dialog rather than an inline popover because a note is structured data: the
 * category chosen decides which further inputs appear, and a strength session can
 * carry a list of lifts with weights. That does not fit in a hover.
 *
 * Everything in here operates at one scope — the one the chart is showing.
 */
function NoteDialog({
  handle, scope, period, notes, onChanged, onClose,
}: {
  handle: string;
  scope: NoteScope;
  period: string;
  notes: StatsNote[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<NoteCategory>(CATEGORIES_BY_SCOPE[scope][0]);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * True when the add form holds something not yet stored.
   *
   * "Done" closes without saving a half-filled form — which is the right
   * behaviour, but only if it is said out loud. An empty flag array counts as
   * nothing: unticking every box is not a draft.
   */
  const draftInProgress = Object.values(data).some((v) =>
    Array.isArray(v) ? v.length > 0 : v !== undefined && v !== "",
  );

  // Escape closes, like any dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The payload's shape depends entirely on the category, so switching category
  // clears it rather than carrying fields that no longer apply.
  const changeCategory = (c: NoteCategory) => { setCategory(c); setData({}) };

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await createStatsNote(handle, { scope, period, category, data });
      setData({});
      onChanged();
    } catch {
      setError("Couldn't save that note. Check the values and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteStatsNote(handle, id, scope);
      onChanged();
    } catch {
      setError("Couldn't delete that note.");
    }
  }

  const isWeek = scope === "week";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isWeek ? "Weekly notes" : "Daily notes"}
        className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(34rem,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-stone-700 bg-stone-900 p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-white">
              {isWeek ? "Weekly notes" : "Daily notes"}
            </h3>
            {/* The column that was clicked, spelled out — the dialog has no picker
                because the card you pressed already chose the period. */}
            <p className="mt-0.5 text-sm text-orange-400">{periodLabel(period, scope)}</p>
            <p className="mt-0.5 text-xs text-stone-500">
              {isWeek
                ? "Switch the chart to Day to add or remove notes on individual days."
                : "Switch the chart to Week to add or remove notes about a whole week."}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-stone-500 transition-colors hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Existing notes at this scope and period — the only ones deletable here. */}
        <div className="mb-4 border-t border-stone-800 pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
            {isWeek ? "Notes for this week" : "Notes for this day"}
          </p>
          {notes.length === 0 ? (
            <p className="text-sm text-stone-500">Nothing yet.</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li
                  key={n.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-stone-700 bg-stone-800 px-3 py-2"
                >
                  <span className="text-sm text-stone-300">
                    <span className="text-orange-400">{CATEGORY_LABELS[n.category]}</span>
                    <span className="text-stone-400"> — {summariseNote(n)}</span>
                  </span>
                  <button
                    onClick={() => void remove(n.id)}
                    className="shrink-0 text-xs text-stone-500 transition-colors hover:text-red-400"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Add */}
        <div className="border-t border-stone-800 pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
            Add note
          </p>

          <label className="mb-3 block">
            <span className="mb-1 block text-xs text-stone-400">Category</span>
            <select
              value={category}
              onChange={(e) => changeCategory(e.target.value as NoteCategory)}
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none"
            >
              {CATEGORIES_BY_SCOPE[scope].map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </label>

          <CategoryFields category={category} scope={scope} data={data} onChange={setData} />

          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

          <button
            onClick={() => void save()}
            disabled={saving}
            className="mt-4 w-full rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:bg-stone-700 disabled:text-stone-500"
          >
            {saving ? "Saving…" : "Add note"}
          </button>
        </div>

        {/*
          A deliberate way out.
          Each note is already stored the moment "Add note" is pressed, but the ✕
          alone gave no sign of that — closing a dialog usually means discarding,
          so it read as though the work might be thrown away. "Done" says the
          interaction is over, and the line beside it says why that is safe.
        */}
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-stone-800 pt-4">
          <p className="text-xs text-stone-500">
            {draftInProgress
              ? "This note isn't saved yet — press Add note first."
              : "Each note is saved as soon as you add it."}
          </p>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg border border-stone-600 bg-stone-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:border-orange-500 hover:text-orange-400"
          >
            Done
          </button>
        </div>
      </div>
    </>
  );
}

// ── Category-specific inputs ──────────────────────────────────────────────────

const fieldClass =
  "w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none";

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-stone-400">{label}</span>
      {children}
    </label>
  );
}

/** A select whose empty option means "not recorded", since most fields are optional. */
function OptionalSelect({
  label, value, options, onChange,
}: {
  label: string;
  value: string | undefined;
  options: readonly string[];
  onChange: (v: string | undefined) => void;
}) {
  return (
    <Labelled label={label}>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        className={fieldClass}
      >
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </Labelled>
  );
}

function NumberField({
  label, value, onChange, min = 0, max = 1000,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
}) {
  return (
    <Labelled label={label}>
      <input
        type="number"
        min={min}
        max={max}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        className={fieldClass}
      />
    </Labelled>
  );
}

/** Checkbox list backed by `data.flags`. */
function FlagList({
  options, data, onChange,
}: {
  options: readonly string[];
  data: Record<string, unknown>;
  onChange: (d: Record<string, unknown>) => void;
}) {
  const flags = (data.flags as string[]) ?? [];
  return (
    <div className="space-y-1.5">
      {options.map((o) => (
        <label key={o} className="flex items-center gap-2 text-sm text-stone-300">
          <input
            type="checkbox"
            checked={flags.includes(o)}
            onChange={(e) =>
              onChange({
                ...data,
                flags: e.target.checked ? [...flags, o] : flags.filter((f) => f !== o),
              })
            }
            className="accent-orange-500"
          />
          {o}
        </label>
      ))}
    </div>
  );
}

/**
 * The inputs for one category.
 *
 * Diet and sleep read from a scope-specific option list — "Slept poorly night
 * before" is a statement about a day, "Had trouble sleeping this week" about a
 * week — and the server validates against the same lists, so the two cannot
 * disagree about what is offerable where.
 */
function CategoryFields({
  category, scope, data, onChange,
}: {
  category: NoteCategory;
  scope: NoteScope;
  data: Record<string, unknown>;
  onChange: (d: Record<string, unknown>) => void;
}) {
  const set = (patch: Record<string, unknown>) => onChange({ ...data, ...patch });

  switch (category) {
    case "outdoor_climbing":
      return (
        <div className="space-y-3">
          <OptionalSelect
            label="Hardest route worked"
            value={data.hardestRouteWorked as string | undefined}
            options={YDS_GRADES}
            onChange={(v) => set({ hardestRouteWorked: v })}
          />
          <OptionalSelect
            label="Hardest route sent"
            value={data.hardestRouteSent as string | undefined}
            options={YDS_GRADES}
            onChange={(v) => set({ hardestRouteSent: v })}
          />
          <NumberField
            label="Pitch count"
            min={1}
            max={60}
            value={data.pitchCount as number | undefined}
            onChange={(v) => set({ pitchCount: v })}
          />
        </div>
      );

    case "outdoor_bouldering":
      return (
        <div className="space-y-3">
          <OptionalSelect
            label="Hardest boulder worked"
            value={data.hardestBoulderWorked as string | undefined}
            options={ALL_GRADES}
            onChange={(v) => set({ hardestBoulderWorked: v })}
          />
          <OptionalSelect
            label="Hardest boulder sent"
            value={data.hardestBoulderSent as string | undefined}
            options={ALL_GRADES}
            onChange={(v) => set({ hardestBoulderSent: v })}
          />
        </div>
      );

    case "strength": {
      const lifts = (data.lifts as { lift: string; maxWeight?: number }[]) ?? [];
      const exercises = (data.exercises as { exercise: string; addedWeight?: number }[]) ?? [];

      const toggleLift = (lift: string, on: boolean) =>
        set({ lifts: on ? [...lifts, { lift }] : lifts.filter((l) => l.lift !== lift) });
      const setLiftWeight = (lift: string, maxWeight: number | undefined) =>
        set({ lifts: lifts.map((l) => (l.lift === lift ? { ...l, maxWeight } : l)) });

      const toggleExercise = (exercise: string, on: boolean) =>
        set({
          exercises: on
            ? [...exercises, { exercise }]
            : exercises.filter((e) => e.exercise !== exercise),
        });
      const setAdded = (exercise: string, addedWeight: number | undefined) =>
        set({
          exercises: exercises.map((e) => (e.exercise === exercise ? { ...e, addedWeight } : e)),
        });

      return (
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-xs text-stone-400">Lifts — max weight this session</p>
            <div className="space-y-1.5">
              {LIFTS.map((lift) => {
                const chosen = lifts.find((l) => l.lift === lift);
                return (
                  <div key={lift} className="flex items-center gap-2">
                    <label className="flex flex-1 items-center gap-2 text-sm text-stone-300">
                      <input
                        type="checkbox"
                        checked={!!chosen}
                        onChange={(e) => toggleLift(lift, e.target.checked)}
                        className="accent-orange-500"
                      />
                      {lift}
                    </label>
                    {chosen && (
                      <input
                        type="number"
                        min={0}
                        max={1000}
                        placeholder="weight"
                        aria-label={`${lift} max weight`}
                        value={chosen.maxWeight ?? ""}
                        onChange={(e) =>
                          setLiftWeight(lift, e.target.value === "" ? undefined : Number(e.target.value))
                        }
                        className="w-24 rounded-lg border border-stone-700 bg-stone-800 px-2 py-1 text-sm text-white focus:border-orange-500 focus:outline-none"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs text-stone-400">Exercises</p>
            <div className="space-y-1.5">
              {EXERCISES.map((exercise) => {
                const chosen = exercises.find((e) => e.exercise === exercise);
                return (
                  <div key={exercise} className="flex items-center gap-2">
                    <label className="flex flex-1 items-center gap-2 text-sm text-stone-300">
                      <input
                        type="checkbox"
                        checked={!!chosen}
                        onChange={(e) => toggleExercise(exercise, e.target.checked)}
                        className="accent-orange-500"
                      />
                      {exercise}
                    </label>
                    {/* Only the pull-up takes added weight. */}
                    {chosen && exercise === WEIGHTED_EXERCISE && (
                      <input
                        type="number"
                        min={0}
                        max={500}
                        placeholder="+ weight"
                        aria-label="Pull-up added weight"
                        value={chosen.addedWeight ?? ""}
                        onChange={(e) =>
                          setAdded(exercise, e.target.value === "" ? undefined : Number(e.target.value))
                        }
                        className="w-24 rounded-lg border border-stone-700 bg-stone-800 px-2 py-1 text-sm text-white focus:border-orange-500 focus:outline-none"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      );
    }

    case "dietary":
      return (
        <div className="space-y-3">
          <FlagList options={DIETARY_FLAGS[scope]} data={data} onChange={onChange} />
          <NumberField
            label={DRINKS_LABEL[scope]}
            min={0}
            max={100}
            value={data.drinks as number | undefined}
            onChange={(v) => set({ drinks: v })}
          />
        </div>
      );

    case "sleep":
      return <FlagList options={SLEEP_FLAGS[scope]} data={data} onChange={onChange} />;
  }
}
