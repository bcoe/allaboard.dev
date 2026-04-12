import { render, screen, act } from "@testing-library/react";
import GamePage from "@/app/game/page";
import Navbar from "@/components/Navbar";
import { getLeaderboard } from "@/lib/db";
import { useAuth } from "@/lib/auth-context";
import type { LeaderboardEntry } from "@/lib/db/remote";

jest.mock("@/lib/db");
jest.mock("@/lib/auth-context");
jest.mock("next/navigation", () => ({
  usePathname: jest.fn().mockReturnValue("/game"),
}));
jest.mock("next/image", () => ({
  __esModule: true,
  default: ({ priority: _p, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) =>
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />,
}));

const mockGetLeaderboard = jest.mocked(getLeaderboard);
const mockUseAuth = jest.mocked(useAuth);

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEntry(handle: string, points: number, overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    id:           handle,
    handle,
    displayName:  handle.charAt(0).toUpperCase() + handle.slice(1),
    avatarColor:  "bg-orange-500",
    points,
    totalTicks:   8,
    hardestGrade: "V6",
    hardestGradeTicks: [{
      id:        `tick-${handle}`,
      climbId:   `climb-${handle}`,
      climbName: "Test Problem",
      grade:     "V6",
      boardName: "Kilter Board",
      angle:     40,
      attempts:  3,
      date:      "2026-01-15T00:00:00.000Z",
    }],
    ...overrides,
  };
}

// Four entries so we can verify rank-4 has no medal
const fourEntries: LeaderboardEntry[] = [
  makeEntry("alice",   500),
  makeEntry("bob",     300),
  makeEntry("charlie", 150),
  makeEntry("diana",    50),
];

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue({ user: null, loading: false, logout: jest.fn(), updateUser: jest.fn() });
  mockGetLeaderboard.mockResolvedValue(fourEntries);
});

// ── Page rendering ────────────────────────────────────────────────────────────

describe("GamePage — page structure", () => {
  it("renders the 'Climbing Game' heading", async () => {
    await act(async () => { render(<GamePage />); });
    expect(screen.getByRole("heading", { name: /climbing game/i })).toBeInTheDocument();
  });

  it("mentions flashes in the description", async () => {
    await act(async () => { render(<GamePage />); });
    expect(screen.getByText(/flashes score higher/i)).toBeInTheDocument();
  });

  it("shows skeleton loading cards before data arrives", () => {
    mockGetLeaderboard.mockReturnValue(new Promise(() => {})); // never resolves
    render(<GamePage />);
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("shows 'No climbers yet.' when the leaderboard is empty", async () => {
    mockGetLeaderboard.mockResolvedValue([]);
    await act(async () => { render(<GamePage />); });
    expect(screen.getByText("No climbers yet.")).toBeInTheDocument();
  });

  it("shows an error message when the API call fails", async () => {
    mockGetLeaderboard.mockRejectedValue(new Error("network error"));
    await act(async () => { render(<GamePage />); });
    expect(screen.getByText(/failed to load leaderboard/i)).toBeInTheDocument();
  });
});

// ── User cards ────────────────────────────────────────────────────────────────

describe("GamePage — user cards", () => {
  it("renders each user's handle", async () => {
    await act(async () => { render(<GamePage />); });
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("@bob")).toBeInTheDocument();
    expect(screen.getByText("@charlie")).toBeInTheDocument();
    expect(screen.getByText("@diana")).toBeInTheDocument();
  });

  it("links each handle to the user's profile page", async () => {
    await act(async () => { render(<GamePage />); });
    const aliceLink = screen.getByText("@alice").closest("a");
    expect(aliceLink).toHaveAttribute("href", "/user/alice");
  });

  it("shows each user's total tick count", async () => {
    await act(async () => { render(<GamePage />); });
    // four entries each have totalTicks = 8, so "8" appears four times
    expect(screen.getAllByText("8")).toHaveLength(4);
  });

  it("shows each user's points formatted with 'pts' suffix", async () => {
    await act(async () => { render(<GamePage />); });
    expect(screen.getByText("500 pts")).toBeInTheDocument();
    expect(screen.getByText("300 pts")).toBeInTheDocument();
    expect(screen.getByText("50 pts")).toBeInTheDocument();
  });

  it("shows the hardest grade badge when present", async () => {
    await act(async () => { render(<GamePage />); });
    // Each entry has V6 as hardest grade — 4 instances
    expect(screen.getAllByText("V6").length).toBeGreaterThanOrEqual(4);
  });

  it("shows '—' for users with no hardest grade", async () => {
    mockGetLeaderboard.mockResolvedValue([
      makeEntry("newbie", 0, { hardestGrade: null, hardestGradeTicks: [] }),
    ]);
    await act(async () => { render(<GamePage />); });
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

// ── Medals ────────────────────────────────────────────────────────────────────

describe("GamePage — medals", () => {
  it("renders medal badges for ranks 1, 2, and 3", async () => {
    await act(async () => { render(<GamePage />); });
    expect(screen.getAllByTestId("medal-badge")).toHaveLength(3);
  });

  it("does not render a medal badge for rank 4 and beyond", async () => {
    await act(async () => { render(<GamePage />); });
    const medals = screen.getAllByTestId("medal-badge");
    // medals contain emoji for ranks 1, 2, 3 — not a "4"
    const medalTexts = medals.map((m) => m.textContent?.trim());
    expect(medalTexts).toContain("🥇");
    expect(medalTexts).toContain("🥈");
    expect(medalTexts).toContain("🥉");
    expect(medalTexts).not.toContain("4");
  });

  it("rank 4 shows a plain rank number outside a medal badge", async () => {
    await act(async () => { render(<GamePage />); });
    // rank-4 number "4" should appear in the DOM but not inside a medal-badge
    const allFours = screen.getAllByText("4");
    const insideMedal = allFours.filter(
      (el) => el.closest("[data-testid='medal-badge']") !== null,
    );
    expect(insideMedal).toHaveLength(0);
  });

  it("no medals at all when only one user with 0 points is present", async () => {
    mockGetLeaderboard.mockResolvedValue([
      makeEntry("solo", 0),
    ]);
    await act(async () => { render(<GamePage />); });
    // rank-1 still gets a medal (top of the board)
    expect(screen.getAllByTestId("medal-badge")).toHaveLength(1);
  });
});

// ── Navbar ────────────────────────────────────────────────────────────────────

describe("Navbar — Game link", () => {
  it("includes a 'Game' link in the primary navigation", () => {
    render(<Navbar />);
    expect(screen.getByText("Game")).toBeInTheDocument();
  });

  it("'Game' links to /game", () => {
    render(<Navbar />);
    expect(screen.getByText("Game").closest("a")).toHaveAttribute("href", "/game");
  });

  it("marks 'Game' as the active nav item when on /game", () => {
    render(<Navbar />);
    const gameLink = screen.getByText("Game").closest("a")!;
    // Active links get bg-stone-800 class
    expect(gameLink.className).toContain("bg-stone-800");
  });
});
