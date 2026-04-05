/**
 * Unit tests for the Detailed Stats page (/user/[handle]/stats).
 *
 * Covers:
 * - Loading and empty states
 * - Page header and back link
 * - Summary tiles (Lifetime Sends, Longest Streak)
 * - Chart sections appear only when ticks exist
 * - Board selector derived from tick data
 * - Date filter controls are rendered
 * - computeLongestStreak logic via the rendered streak tile
 */

import { render, screen, fireEvent } from "@testing-library/react";
import UserStatsPage from "@/app/user/[handle]/stats/page";
import { getUserTicks } from "@/lib/db";
import type { UserTick } from "@/lib/types";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("@/lib/db");
jest.mock("next/navigation", () => ({
  useParams: jest.fn().mockReturnValue({ handle: "alice" }),
}));

// ECharts uses dynamic import and a canvas API not available in jsdom — stub it.
// convertToPixel is called by drawSundayLines after chart init; return 0 as a
// safe no-op value so pixel arithmetic doesn't throw.
jest.mock("echarts", () => ({
  init: jest.fn(() => ({
    setOption: jest.fn(),
    resize: jest.fn(),
    dispose: jest.fn(),
    convertToPixel: jest.fn().mockReturnValue(0),
  })),
}));

// ResizeObserver is not implemented in jsdom.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const mockGetUserTicks = jest.mocked(getUserTicks);

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTick(overrides: Partial<UserTick> = {}): UserTick {
  return {
    id: "tick-1",
    climbId: "climb-1",
    climbName: "Test Problem",
    grade: "V5",
    boardName: "Kilter Board (Original)",
    angle: 40,
    sent: true,
    attempts: 3,
    rating: 3,
    comment: "",
    date: "2026-01-15",
    createdAt: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  mockGetUserTicks.mockResolvedValue([]);
});

afterEach(() => jest.clearAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("UserStatsPage — loading & empty state", () => {
  it("shows a loading indicator before ticks resolve", () => {
    // Never resolve so we stay in loading state
    mockGetUserTicks.mockReturnValue(new Promise(() => {}));
    render(<UserStatsPage />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows the page title with the user's handle after loading", async () => {
    render(<UserStatsPage />);
    expect(await screen.findByText("Detailed Stats for @alice")).toBeInTheDocument();
  });

  it("shows the empty-state message when there are no ticks", async () => {
    render(<UserStatsPage />);
    await screen.findByText("Detailed Stats for @alice");
    expect(screen.getByText("more, more!")).toBeInTheDocument();
  });

  it("does not render the Sends or Grade Pyramid sections when there are no ticks", async () => {
    render(<UserStatsPage />);
    await screen.findByText("Detailed Stats for @alice");
    expect(screen.queryByText("Sends")).not.toBeInTheDocument();
    expect(screen.queryByText("Grade Pyramid")).not.toBeInTheDocument();
  });
});

describe("UserStatsPage — page header", () => {
  it("renders a back link pointing to the user's profile page", async () => {
    render(<UserStatsPage />);
    await screen.findByText("Detailed Stats for @alice");
    const backLink = screen.getByRole("link", { name: /back to profile/i });
    expect(backLink).toHaveAttribute("href", "/user/alice");
  });
});

describe("UserStatsPage — summary tiles", () => {
  it("shows 0 lifetime sends when there are no ticks", async () => {
    render(<UserStatsPage />);
    await screen.findByText("Lifetime Sends");
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("counts only sent ticks toward Lifetime Sends", async () => {
    mockGetUserTicks.mockResolvedValue([
      makeTick({ id: "t1", sent: true }),
      makeTick({ id: "t2", sent: true }),
      makeTick({ id: "t3", sent: false }),
    ]);
    render(<UserStatsPage />);
    await screen.findByText("Lifetime Sends");
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows 0w streak when there are no ticks", async () => {
    render(<UserStatsPage />);
    await screen.findByText("Longest Streak");
    expect(screen.getByText("0w")).toBeInTheDocument();
  });

  it("shows the sub-label 'consecutive weeks sending something' under Longest Streak", async () => {
    render(<UserStatsPage />);
    await screen.findByText("Longest Streak");
    expect(screen.getByText("consecutive weeks sending something")).toBeInTheDocument();
  });

  it("computes a streak of 1 for ticks all in the same week", async () => {
    mockGetUserTicks.mockResolvedValue([
      makeTick({ id: "t1", date: "2026-01-12" }), // Mon
      makeTick({ id: "t2", date: "2026-01-14" }), // Wed — same Sun–Sat week
    ]);
    render(<UserStatsPage />);
    await screen.findByText("Longest Streak");
    expect(screen.getByText("1w")).toBeInTheDocument();
  });

  it("computes a streak of 2 for ticks in back-to-back weeks", async () => {
    mockGetUserTicks.mockResolvedValue([
      makeTick({ id: "t1", date: "2026-01-12" }), // week of 2026-01-11
      makeTick({ id: "t2", date: "2026-01-19" }), // week of 2026-01-18 — consecutive
    ]);
    render(<UserStatsPage />);
    await screen.findByText("Longest Streak");
    expect(screen.getByText("2w")).toBeInTheDocument();
  });

  it("resets streak when there is a gap between weeks", async () => {
    mockGetUserTicks.mockResolvedValue([
      makeTick({ id: "t1", date: "2026-01-05" }), // week of 2026-01-04
      makeTick({ id: "t2", date: "2026-01-12" }), // week of 2026-01-11 — consecutive: streak=2
      // gap: no tick week of 2026-01-18
      makeTick({ id: "t3", date: "2026-01-26" }), // week of 2026-01-25 — new run of 1
    ]);
    render(<UserStatsPage />);
    await screen.findByText("Longest Streak");
    expect(screen.getByText("2w")).toBeInTheDocument();
  });
});

describe("UserStatsPage — chart sections", () => {
  it("renders the Sends and Grade Pyramid sections when ticks exist", async () => {
    mockGetUserTicks.mockResolvedValue([makeTick()]);
    render(<UserStatsPage />);
    expect(await screen.findByText("Sends")).toBeInTheDocument();
    expect(screen.getByText("Grade Pyramid")).toBeInTheDocument();
  });

  it("renders the 'More, more!' subtitle under Sends", async () => {
    mockGetUserTicks.mockResolvedValue([makeTick()]);
    render(<UserStatsPage />);
    await screen.findByText("Sends");
    expect(screen.getByText("More, more!")).toBeInTheDocument();
  });

  it("renders the pyramid subtitle", async () => {
    mockGetUserTicks.mockResolvedValue([makeTick()]);
    render(<UserStatsPage />);
    await screen.findByText("Grade Pyramid");
    expect(
      screen.getByText("Even the Great Pyramid was built one session at a time.")
    ).toBeInTheDocument();
  });

  it("renders date filter inputs for each chart section", async () => {
    mockGetUserTicks.mockResolvedValue([makeTick()]);
    render(<UserStatsPage />);
    await screen.findByText("Sends");
    // Two chart sections, each with a "from" and "to" date input → 4 inputs total
    const dateInputs = screen.getAllByDisplayValue(/^\d{4}-\d{2}-\d{2}$/);
    expect(dateInputs.length).toBeGreaterThanOrEqual(4);
  });
});

describe("UserStatsPage — board selector", () => {
  it("shows the board selector when ticks have a boardName", async () => {
    mockGetUserTicks.mockResolvedValue([
      makeTick({ boardName: "Kilter Board (Original)" }),
    ]);
    render(<UserStatsPage />);
    await screen.findByText("Sends");
    // "All boards" button label appears for each chart's BoardSelect
    expect(screen.getAllByText("All boards").length).toBeGreaterThanOrEqual(1);
  });

  it("fetches ticks scoped to the handle from the URL", async () => {
    render(<UserStatsPage />);
    await screen.findByText("Detailed Stats for @alice");
    expect(mockGetUserTicks).toHaveBeenCalledWith("alice");
  });
});

// ── Date range clamping ───────────────────────────────────────────────────────

describe("UserStatsPage — date range clamping (max 3 years)", () => {
  /** Compute the earliest allowed dateFrom given a dateTo string. */
  function minDateFrom(dateTo: string): string {
    const d = new Date(dateTo + "T00:00:00");
    d.setFullYear(d.getFullYear() - 3);
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
    ].join("-");
  }

  beforeEach(() => {
    mockGetUserTicks.mockResolvedValue([makeTick()]);
  });

  it("clamps dateFrom to 3 years before dateTo when a far-past date is typed", async () => {
    render(<UserStatsPage />);
    await screen.findByText("Sends");

    // First two date inputs belong to the Sends (heatmap) chart.
    const [dateFromInput, dateToInput] = screen.getAllByDisplayValue(/^\d{4}-\d{2}-\d{2}$/);
    const dateTo = (dateToInput as HTMLInputElement).value;

    fireEvent.change(dateFromInput, { target: { value: "1990-01-01" } });

    expect((dateFromInput as HTMLInputElement).value).toBe(minDateFrom(dateTo));
  });

  it("does not clamp dateFrom when it is within the 3-year window", async () => {
    render(<UserStatsPage />);
    await screen.findByText("Sends");

    const [dateFromInput, dateToInput] = screen.getAllByDisplayValue(/^\d{4}-\d{2}-\d{2}$/);
    const dateTo = (dateToInput as HTMLInputElement).value;

    // 1 year ago — well within the 3-year limit.
    const oneYearAgo = (() => {
      const d = new Date(dateTo + "T00:00:00");
      d.setFullYear(d.getFullYear() - 1);
      return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, "0"),
        String(d.getDate()).padStart(2, "0"),
      ].join("-");
    })();

    fireEvent.change(dateFromInput, { target: { value: oneYearAgo } });

    expect((dateFromInput as HTMLInputElement).value).toBe(oneYearAgo);
  });

  it("re-clamps dateFrom when dateTo is pulled back past the 3-year window", async () => {
    render(<UserStatsPage />);
    await screen.findByText("Sends");

    const [dateFromInput, dateToInput] = screen.getAllByDisplayValue(/^\d{4}-\d{2}-\d{2}$/);

    // First set dateFrom to something reasonable (1 year ago).
    const dateTo = (dateToInput as HTMLInputElement).value;
    const oneYearAgo = (() => {
      const d = new Date(dateTo + "T00:00:00");
      d.setFullYear(d.getFullYear() - 1);
      return [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-");
    })();
    fireEvent.change(dateFromInput, { target: { value: oneYearAgo } });
    expect((dateFromInput as HTMLInputElement).value).toBe(oneYearAgo);

    // Now move dateTo back to 2 years after the current dateFrom — which would
    // put dateFrom more than 3 years before the new dateTo.
    // Use a dateTo that is only 1 month after a dateFrom that is already 3+ years ago.
    const veryOldDateTo = "2020-06-01";
    fireEvent.change(dateToInput, { target: { value: veryOldDateTo } });

    // dateFrom must be clamped to at most 3 years before veryOldDateTo.
    const clamped = (dateFromInput as HTMLInputElement).value;
    expect(clamped).toBe(minDateFrom(veryOldDateTo));
  });

  it("exposes the min attribute on the dateFrom input matching the 3-year limit", async () => {
    render(<UserStatsPage />);
    await screen.findByText("Sends");

    const [dateFromInput, dateToInput] = screen.getAllByDisplayValue(/^\d{4}-\d{2}-\d{2}$/);
    const dateTo = (dateToInput as HTMLInputElement).value;

    expect((dateFromInput as HTMLInputElement).min).toBe(minDateFrom(dateTo));
  });
});
