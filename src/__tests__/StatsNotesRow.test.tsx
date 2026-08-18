/**
 * The per-column note cards above the sends timeline.
 *
 * One card per chart column, aligned to it, so the column you are looking at is
 * the period you annotate. What is worth pinning: a card exists for every column
 * and sits where the column does; week notes and day notes stay distinct kinds;
 * and the week view shows the daily notes inside a week without offering to edit
 * them, because that is the rule the server enforces too.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import StatsNotesRow from "@/components/StatsNotesRow";
import type { StatsNote } from "@/lib/statsNotes";

jest.mock("@/lib/db", () => ({
  getStatsNotes: jest.fn(),
  createStatsNote: jest.fn(),
  deleteStatsNote: jest.fn(),
}));

import { getStatsNotes, createStatsNote, deleteStatsNote } from "@/lib/db";

const mockGet = jest.mocked(getStatsNotes);
const mockCreate = jest.mocked(createStatsNote);
const mockDelete = jest.mocked(deleteStatsNote);

/** Three consecutive Mondays, and three consecutive days inside the first. */
const WEEKS = ["2026-08-03", "2026-08-10", "2026-08-17"];
const DAYS = ["2026-08-03", "2026-08-04", "2026-08-05"];

/** Synthetic geometry standing in for what ECharts reports. */
const columns = (n: number, width = 40, first = 60) =>
  Array.from({ length: n }, (_, i) => ({ x: first + i * width, width }));

const note = (over: Partial<StatsNote> = {}): StatsNote => ({
  id: "n1",
  scope: "week",
  period: "2026-08-10",
  category: "dietary",
  data: { flags: ["Stayed well hydrated"], drinks: 4 },
  createdAt: "2026-08-10T10:00:00.000Z",
  ...over,
});

const cards = () => screen.getAllByRole("button", { name: /Notes for/i });

async function renderRow(props: Parameters<typeof StatsNotesRow>[0]) {
  const view = render(<StatsNotesRow {...props} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalled());
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue([]);
});

describe("one card per column", () => {
  it("renders a card for every week column in week view", async () => {
    await renderRow({ handle: "alice", scope: "week", periods: WEEKS, columns: columns(3) });

    expect(cards()).toHaveLength(3);
  });

  it("renders a card for every day column in day view", async () => {
    await renderRow({ handle: "alice", scope: "day", periods: DAYS, columns: columns(3, 5) });

    expect(cards()).toHaveLength(3);
  });

  it("positions each card on its own column", async () => {
    // Alignment is the whole point — a card over the wrong column is worse than
    // no card. Centre 60 with width 40 puts the left edge at 40 (+1 inset).
    await renderRow({ handle: "alice", scope: "week", periods: WEEKS, columns: columns(3) });

    const [first, second] = cards();
    expect(first.style.left).toBe("41px");
    expect(second.style.left).toBe("81px");
    expect(first.style.width).toBe("38px");
  });

  it("draws nothing until the chart has reported its layout", async () => {
    // Before ECharts lays out there is no geometry to align to.
    await renderRow({ handle: "alice", scope: "week", periods: WEEKS, columns: [] });

    expect(screen.queryAllByRole("button", { name: /Notes for/i })).toHaveLength(0);
  });

  it("stays hittable when day columns are only a few pixels wide", async () => {
    // Six months of days is ~182 columns; a card still needs a usable target.
    await renderRow({ handle: "alice", scope: "day", periods: DAYS, columns: columns(3, 3) });

    for (const c of cards()) {
      expect(parseInt(c.style.width, 10)).toBeGreaterThanOrEqual(3);
      expect(parseInt(c.style.height, 10)).toBeGreaterThan(12);
    }
  });
});

describe("week notes and day notes are distinct kinds", () => {
  it("marks the week that carries a week note", async () => {
    mockGet.mockResolvedValue([note({ scope: "week", period: "2026-08-10" })]);
    await renderRow({ handle: "alice", scope: "week", periods: WEEKS, columns: columns(3) });

    expect(cards()[1]).toHaveAccessibleName(/1 note/);
    expect(cards()[0]).not.toHaveAccessibleName(/note[s]?$/);
  });

  it("files a day note under its week in week view", async () => {
    // 2026-08-04 is the Tuesday of the week beginning 2026-08-03.
    mockGet.mockResolvedValue([note({ id: "d1", scope: "day", period: "2026-08-04" })]);
    await renderRow({ handle: "alice", scope: "week", periods: WEEKS, columns: columns(3) });

    expect(cards()[0]).toHaveAccessibleName(/1 note/);
  });

  it("does not show a week note on any day card", async () => {
    // A week note describes the whole week and belongs to no single day.
    mockGet.mockResolvedValue([note({ scope: "week", period: "2026-08-03" })]);
    await renderRow({ handle: "alice", scope: "day", periods: DAYS, columns: columns(3) });

    for (const c of cards()) expect(c).not.toHaveAccessibleName(/1 note/);
  });
});

describe("hovering a card", () => {
  it("splits the week's own notes from its days' notes into two sections", async () => {
    mockGet.mockResolvedValue([
      note({ id: "w1", scope: "week", period: "2026-08-03", category: "sleep", data: { flags: ["Slept well this week"] } }),
      note({ id: "d1", scope: "day", period: "2026-08-04", category: "strength", data: { lifts: [{ lift: "Squat", maxWeight: 120 }] } }),
    ]);
    await renderRow({ handle: "alice", scope: "week", periods: WEEKS, columns: columns(3) });

    fireEvent.mouseEnter(cards()[0]);

    expect(screen.getByText("This week")).toBeInTheDocument();
    expect(screen.getByText("Days this week")).toBeInTheDocument();
    expect(screen.getByText(/Slept well this week/)).toBeInTheDocument();
    expect(screen.getByText(/Squat 120/)).toBeInTheDocument();
  });

  it("names the period it is showing", async () => {
    await renderRow({ handle: "alice", scope: "week", periods: WEEKS, columns: columns(3) });

    fireEvent.mouseEnter(cards()[0]);

    // A week reads as its Monday–Sunday span, so there is no doubt what is meant.
    expect(screen.getByRole("tooltip").textContent).toMatch(/Mon,\s*Aug\s*3.*–.*Sun,\s*Aug\s*9/);
  });

  it("invites a first note when the period is empty", async () => {
    await renderRow({ handle: "alice", scope: "day", periods: DAYS, columns: columns(3) });

    fireEvent.mouseEnter(cards()[1]);

    expect(screen.getByText(/No notes yet/i)).toBeInTheDocument();
  });
});

describe("clicking a card opens that period's editor", () => {
  it("edits the column that was clicked, with no picker to disagree with it", async () => {
    mockCreate.mockResolvedValue(note({ scope: "week", period: "2026-08-17" }));
    await renderRow({ handle: "alice", scope: "week", periods: WEEKS, columns: columns(3) });

    fireEvent.click(cards()[2]);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Weekly notes");
    // No date input: the card already chose the period.
    expect(dialog.querySelector('input[type="date"]')).toBeNull();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Add note/i })) });

    expect(mockCreate).toHaveBeenCalledWith(
      "alice",
      expect.objectContaining({ scope: "week", period: "2026-08-17" }),
    );
  });

  it("offers only the categories that make sense for a week", async () => {
    await renderRow({ handle: "alice", scope: "week", periods: WEEKS, columns: columns(3) });
    fireEvent.click(cards()[0]);

    const options = Array.from(
      screen.getByLabelText("Category").querySelectorAll("option"),
    ).map((o) => o.textContent);

    expect(options).toEqual(["Dietary Notes", "Sleep Notes"]);
  });

  it("offers the session categories on a day", async () => {
    await renderRow({ handle: "alice", scope: "day", periods: DAYS, columns: columns(3) });
    fireEvent.click(cards()[0]);

    const options = Array.from(
      screen.getByLabelText("Category").querySelectorAll("option"),
    ).map((o) => o.textContent);

    expect(options).toContain("Outdoor Bouldering Session");
    expect(options).toContain("Strength Session");
  });

  it("deletes only at the scope being viewed", async () => {
    // The week view lists a week's daily notes for context, but the editor shows
    // — and can delete — only the week's own.
    mockGet.mockResolvedValue([
      note({ id: "w1", scope: "week", period: "2026-08-03" }),
      note({ id: "d1", scope: "day", period: "2026-08-04" }),
    ]);
    mockDelete.mockResolvedValue(undefined);
    await renderRow({ handle: "alice", scope: "week", periods: WEEKS, columns: columns(3) });

    fireEvent.click(cards()[0]);

    const deletes = screen.getAllByRole("button", { name: /^Delete$/ });
    expect(deletes).toHaveLength(1); // the week note only

    await act(async () => { fireEvent.click(deletes[0]) });

    expect(mockDelete).toHaveBeenCalledWith("alice", "w1", "week");
  });
});

// ── Finishing ─────────────────────────────────────────────────────────────────
//
// Notes are stored the moment "Add note" is pressed, but a ✕ on its own gave no
// sign of that: closing a dialog normally means discarding, so it read as though
// the work might be thrown away. These pin the affordance that says otherwise.

describe("finishing", () => {
  it("offers a Done button, not just an ✕", async () => {
    await renderRow({ handle: "alice", scope: "week", periods: WEEKS, columns: columns(3) });
    fireEvent.click(cards()[0]);

    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("says that notes are already saved", async () => {
    await renderRow({ handle: "alice", scope: "week", periods: WEEKS, columns: columns(3) });
    fireEvent.click(cards()[0]);

    expect(screen.getByText(/saved as soon as you add it/i)).toBeInTheDocument();
  });

  it("closes the dialog when Done is pressed", async () => {
    await renderRow({ handle: "alice", scope: "week", periods: WEEKS, columns: columns(3) });
    fireEvent.click(cards()[0]);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("warns instead when a half-filled note would be discarded", async () => {
    // Done does not save a draft, which is the right behaviour — but only if it
    // is said out loud, otherwise typed input vanishes without explanation.
    mockGet.mockResolvedValue([]);
    await renderRow({ handle: "alice", scope: "week", periods: WEEKS, columns: columns(3) });
    fireEvent.click(cards()[0]);

    fireEvent.click(screen.getByLabelText(/Stayed well hydrated/i));

    expect(screen.getByText(/isn't saved yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/saved as soon as you add it/i)).not.toBeInTheDocument();
  });

  it("goes back to the reassurance once the draft is stored", async () => {
    mockCreate.mockResolvedValue(note({ scope: "week", period: "2026-08-03" }));
    await renderRow({ handle: "alice", scope: "week", periods: WEEKS, columns: columns(3) });
    fireEvent.click(cards()[0]);

    fireEvent.click(screen.getByLabelText(/Stayed well hydrated/i));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Add note/i })) });

    expect(screen.getByText(/saved as soon as you add it/i)).toBeInTheDocument();
  });

  it("does not treat an emptied checkbox list as a draft", async () => {
    // Ticking then unticking leaves an empty array, which is not unsaved work.
    await renderRow({ handle: "alice", scope: "week", periods: WEEKS, columns: columns(3) });
    fireEvent.click(cards()[0]);

    const box = screen.getByLabelText(/Stayed well hydrated/i);
    fireEvent.click(box);
    fireEvent.click(box);

    expect(screen.getByText(/saved as soon as you add it/i)).toBeInTheDocument();
  });
});

// ── The note mark ─────────────────────────────────────────────────────────────
//
// A faint note glyph behind each card's label, so an empty column still reads as
// "notes go here" rather than as an unexplained cell — without a row of solid
// icons competing with the chart underneath.

describe("the note mark", () => {
  const glyphs = (c: HTMLElement) => c.querySelectorAll("svg");

  it("sits behind the card on a column wide enough to hold it", async () => {
    const { container } = await renderRow({
      handle: "alice", scope: "week", periods: WEEKS, columns: columns(3, 40),
    });

    for (const card of cards()) expect(glyphs(card)).toHaveLength(1);
    expect(container.querySelector("svg")).toHaveClass("opacity-30");
  });

  it("shows on an empty card, which is the case that needed explaining", async () => {
    mockGet.mockResolvedValue([]);
    await renderRow({ handle: "alice", scope: "week", periods: WEEKS, columns: columns(3, 40) });

    expect(glyphs(cards()[0])).toHaveLength(1);
  });

  it("is dropped where a day column is too narrow for it", async () => {
    // A squeezed glyph is noise, not a hint.
    await renderRow({ handle: "alice", scope: "day", periods: DAYS, columns: columns(3, 5) });

    for (const card of cards()) expect(glyphs(card)).toHaveLength(0);
  });

  it("stays out of the accessibility tree, since the button is already labelled", async () => {
    await renderRow({ handle: "alice", scope: "week", periods: WEEKS, columns: columns(3, 40) });

    const glyph = cards()[0].querySelector("svg");
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(glyph).toHaveClass("pointer-events-none");
  });

  it("does not crowd out the note count", async () => {
    mockGet.mockResolvedValue([note({ scope: "week", period: "2026-08-10" })]);
    await renderRow({ handle: "alice", scope: "week", periods: WEEKS, columns: columns(3, 40) });

    expect(cards()[1].textContent).toBe("1");
    expect(glyphs(cards()[1])).toHaveLength(1);
  });
});
