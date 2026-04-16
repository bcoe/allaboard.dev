import { render, screen, act, fireEvent } from "@testing-library/react";
import ClimbsPage from "@/app/climbs/page";
import { getClimbs } from "@/lib/db";
import { useAuth } from "@/lib/auth-context";
import { useRouter, useSearchParams } from "next/navigation";
import type { User, Climb } from "@/lib/types";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("@/lib/db");
jest.mock("@/lib/auth-context");
jest.mock("next/navigation", () => ({
  usePathname:     jest.fn().mockReturnValue("/climbs"),
  useRouter:       jest.fn(),
  useSearchParams: jest.fn(),
}));
jest.mock("@/components/ClimbCard", () => ({
  __esModule: true,
  default: ({ climb }: { climb: Climb }) => (
    <div data-testid="climb-card">{climb.name}</div>
  ),
}));
jest.mock("@/components/TickModal", () => ({ __esModule: true, default: () => null }));

const mockGetClimbs       = jest.mocked(getClimbs);
const mockUseAuth         = jest.mocked(useAuth);
const mockUseRouter       = jest.mocked(useRouter);
const mockUseSearchParams = jest.mocked(useSearchParams);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const loggedInUser: User = {
  id: "alice", handle: "alice", displayName: "Alice",
  avatarColor: "bg-orange-500", bio: "", homeBoard: "Kilter Board",
  homeBoardAngle: 40, joinedAt: "2026-01-01T00:00:00Z",
  followersCount: 0, followingCount: 0, personalBests: {},
};

function makeClimb(id: string, name: string): Climb {
  return {
    id, name, grade: "V5", boardId: "kilter", boardName: "Kilter Board",
    angle: 40, description: "", author: "alice", sends: 0,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

const noResults  = { climbs: [],                               hasMore: false, total: 0 };
const oneResult  = { climbs: [makeClimb("c1", "Test Problem")], hasMore: false, total: 1 };

// ── Setup ─────────────────────────────────────────────────────────────────────

// Mutable URL params — the router.replace mock writes here so the next render
// sees the same params a real navigation would produce.
let currentParams = new URLSearchParams();

// Exposed so tests can assert on which URL router.replace was called with.
let mockReplace: jest.Mock;

// Saved by renderPage() so search() can force a re-render with updated params.
let rerenderPage: (ui: React.ReactElement) => void = () => {};

beforeEach(() => {
  jest.clearAllMocks();
  currentParams = new URLSearchParams();

  mockUseSearchParams.mockImplementation(
    () => currentParams as unknown as ReturnType<typeof useSearchParams>,
  );
  mockReplace = jest.fn().mockImplementation((url: string) => {
    const qs = typeof url === "string" && url.includes("?") ? url.split("?")[1] : "";
    currentParams = new URLSearchParams(qs);
    mockUseSearchParams.mockImplementation(
      () => currentParams as unknown as ReturnType<typeof useSearchParams>,
    );
  });
  mockUseRouter.mockReturnValue({
    replace: mockReplace,
    push: jest.fn(),
  } as unknown as ReturnType<typeof useRouter>);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve([]) });
  mockGetClimbs.mockResolvedValue(noResults);
  mockUseAuth.mockReturnValue({ user: loggedInUser, loading: false, logout: jest.fn(), updateUser: jest.fn() });
});

// Render and wait for the boards → climbs double-fetch to settle.
async function renderPage() {
  await act(async () => {
    const { rerender } = render(<ClimbsPage />);
    rerenderPage = rerender;
  });
}

// Type into the search box, advance the 300 ms debounce, then re-render so the
// component reads the URL params that router.replace wrote.
async function search(query: string) {
  jest.useFakeTimers();
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText("Search climbs…"), { target: { value: query } });
    jest.runAllTimers();
  });
  await act(async () => {}); // flush pending state updates
  jest.useRealTimers();
  await act(async () => { rerenderPage(<ClimbsPage />); });
}

// ── "Create the climb" prompt ─────────────────────────────────────────────────

describe("ClimbsPage — Create the climb prompt", () => {
  it("appears for a logged-in user when a search returns no results", async () => {
    await renderPage();
    await search("Nonexistent Route");
    expect(screen.getByText(/Create the climb/i)).toBeInTheDocument();
  });

  it("includes the search query as the climb name", async () => {
    await renderPage();
    await search("Cobra Crack");
    expect(screen.getByText("Cobra Crack")).toBeInTheDocument();
  });

  it("links to /climbs/new with the query pre-encoded as ?name=", async () => {
    await renderPage();
    await search("Cobra Crack");
    const link = screen.getByRole("link", { name: /Create the climb/i });
    expect(link).toHaveAttribute("href", "/climbs/new?name=Cobra%20Crack");
  });

  it("does NOT appear when the user is not logged in", async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: jest.fn(), updateUser: jest.fn() });
    await renderPage();
    await search("Cobra Crack");
    expect(screen.queryByText(/Create the climb/i)).not.toBeInTheDocument();
  });

  it("does NOT appear when there is no search query (filter-only empty state)", async () => {
    await renderPage();
    expect(screen.queryByText(/Create the climb/i)).not.toBeInTheDocument();
    expect(screen.getByText("No climbs match these filters.")).toBeInTheDocument();
  });

  it("shows 'No results for' message when a search query returns no results", async () => {
    await renderPage();
    await search("Nonexistent Route");
    expect(screen.getByText(/No results for "Nonexistent Route"/)).toBeInTheDocument();
  });

  it("appends &boardId= to the link when exactly one board is selected", async () => {
    // user.homeBoard = "Kilter Board" → auto-selects kilter when boards load
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve([
        { id: "kilter", name: "Kilter Board", type: "standard", relativeDifficulty: 1.0 },
      ]),
    });
    await renderPage();
    await search("Nonexistent");
    const link = screen.getByRole("link", { name: /Create the climb/i });
    expect(link).toHaveAttribute("href", "/climbs/new?name=Nonexistent&boardId=kilter");
  });

  it("omits boardId from the link when no board filter is active", async () => {
    // default fetch returns no boards → boardIds stays []
    await renderPage();
    await search("Nonexistent");
    const link = screen.getByRole("link", { name: /Create the climb/i });
    expect(link.getAttribute("href")).not.toContain("boardId");
  });
});

// ── "Submit climb" link ────────────────────────────────────────────────────────

describe("ClimbsPage — Submit climb link", () => {
  it("appears for a logged-in user when results are present", async () => {
    mockGetClimbs.mockResolvedValue(oneResult);
    await renderPage();
    expect(screen.getByRole("link", { name: /Submit climb/i })).toBeInTheDocument();
  });

  it("links to /climbs/new", async () => {
    mockGetClimbs.mockResolvedValue(oneResult);
    await renderPage();
    expect(screen.getByRole("link", { name: /Submit climb/i })).toHaveAttribute("href", "/climbs/new");
  });

  it("appears when there is no query and no results (no create prompt to conflict with)", async () => {
    await renderPage();
    expect(screen.getByRole("link", { name: /Submit climb/i })).toBeInTheDocument();
  });

  it("is hidden when the 'Create the climb' prompt is showing", async () => {
    await renderPage();
    await search("Cobra Crack");
    expect(screen.getByText(/Create the climb/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Submit climb/i })).not.toBeInTheDocument();
  });

  it("is hidden when the user is not logged in", async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: jest.fn(), updateUser: jest.fn() });
    mockGetClimbs.mockResolvedValue(oneResult);
    await renderPage();
    expect(screen.queryByRole("link", { name: /Submit climb/i })).not.toBeInTheDocument();
  });
});

// ── URL state persistence ──────────────────────────────────────────────────────

describe("ClimbsPage — URL state persistence", () => {
  it("restores search input and passes all URL params to getClimbs on mount", async () => {
    currentParams = new URLSearchParams("q=arete&gradeMin=V5&gradeMax=V8&angleMin=40&angleMax=50");
    mockUseSearchParams.mockImplementation(
      () => currentParams as unknown as ReturnType<typeof useSearchParams>,
    );
    await renderPage();
    expect(screen.getByPlaceholderText("Search climbs…")).toHaveValue("arete");
    expect(mockGetClimbs).toHaveBeenCalledWith(expect.objectContaining({
      q: "arete",
      gradeMin: "V5",
      gradeMax: "V8",
      angleMin: 40,
      angleMax: 50,
    }));
  });

  it("writes a non-default sort to the URL when the sort control is changed", async () => {
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Sort:/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Top Rated" }));
    });
    expect(mockReplace).toHaveBeenLastCalledWith(
      expect.stringContaining("sort=star_rating_desc"),
      expect.objectContaining({ scroll: false }),
    );
  });

  it("omits sort from the URL when it equals the default (sends_desc)", async () => {
    currentParams = new URLSearchParams("sort=grade_asc");
    mockUseSearchParams.mockImplementation(
      () => currentParams as unknown as ReturnType<typeof useSearchParams>,
    );
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Sort:/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Most Repeats" }));
    });
    const lastUrl: string = mockReplace.mock.calls[mockReplace.mock.calls.length - 1][0];
    expect(lastUrl).not.toContain("sort=");
  });

  it("does not apply the home board default when the URL already has a boards param", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve([
        { id: "kilter", name: "Kilter Board",   type: "standard", relativeDifficulty: 1.0 },
        { id: "moon",   name: "Moonboard 2016", type: "standard", relativeDifficulty: 1.0 },
      ]),
    });
    currentParams = new URLSearchParams("boards=moon");
    mockUseSearchParams.mockImplementation(
      () => currentParams as unknown as ReturnType<typeof useSearchParams>,
    );
    await renderPage();
    // router.replace must not have overwritten boards=moon with the home board (kilter)
    const boardReplaceCalls = mockReplace.mock.calls.filter(([url]: [string]) =>
      url.includes("boards=kilter"),
    );
    expect(boardReplaceCalls).toHaveLength(0);
    // The moonboard filter must still reach getClimbs
    expect(mockGetClimbs).toHaveBeenCalledWith(
      expect.objectContaining({ boardIds: ["moon"] }),
    );
  });
});
