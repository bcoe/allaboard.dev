import { render, screen, act, fireEvent } from "@testing-library/react";
import ClimbsPage from "@/app/climbs/page";
import { getClimbs } from "@/lib/db";
import { useAuth } from "@/lib/auth-context";
import type { User, Climb } from "@/lib/types";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("@/lib/db");
jest.mock("@/lib/auth-context");
jest.mock("next/navigation", () => ({
  usePathname: jest.fn().mockReturnValue("/climbs"),
}));
jest.mock("@/components/ClimbCard", () => ({
  __esModule: true,
  default: ({ climb }: { climb: Climb }) => (
    <div data-testid="climb-card">{climb.name}</div>
  ),
}));
jest.mock("@/components/TickModal", () => ({ __esModule: true, default: () => null }));

const mockGetClimbs = jest.mocked(getClimbs);
const mockUseAuth   = jest.mocked(useAuth);

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

beforeEach(() => {
  jest.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve([]) });
  mockGetClimbs.mockResolvedValue(noResults);
  mockUseAuth.mockReturnValue({ user: loggedInUser, loading: false, logout: jest.fn(), updateUser: jest.fn() });
});

// helper: render the page and wait for the boards → climbs double-fetch to settle
async function renderPage() {
  await act(async () => { render(<ClimbsPage />); });
}

// helper: type into the search box and wait for the re-fetch
async function search(query: string) {
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText("Search climbs…"), { target: { value: query } });
  });
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
