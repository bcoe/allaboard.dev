/**
 * Frontend ACL tests for /climbs/[id]
 *
 * Climbs are a protected resource. The "Edit climb" button must only be visible
 * to the climb's author (climb.author === user.id). These tests will FAIL if
 * the owner check is removed or the edit control is shown to everyone.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import ClimbPage from "@/app/climbs/[id]/page";
import { useAuth } from "@/lib/auth-context";
import { getClimbById, getClimbTicks } from "@/lib/db";
import type { User, Climb } from "@/lib/types";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("@/lib/auth-context");
jest.mock("@/lib/db");
jest.mock("next/navigation", () => ({
  useParams: jest.fn().mockReturnValue({ id: "climb-1" }),
}));
jest.mock("@/components/TickModal",      () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/ClimbEditModal", () => ({
  __esModule: true,
  default: ({ climb, onClose }: { climb: Climb; onClose: () => void }) => (
    <div data-testid="climb-edit-modal">
      <span>Edit Climb Modal — {climb.name}</span>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));
jest.mock("@/components/GradeBadge", () => ({
  __esModule: true,
  default: ({ grade }: { grade: string }) => <span>{grade}</span>,
}));
jest.mock("@/components/StarRating", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/UserAvatar", () => ({
  __esModule: true,
  default: () => null,
}));

const mockUseAuth        = jest.mocked(useAuth);
const mockGetClimbById   = jest.mocked(getClimbById);
const mockGetClimbTicks  = jest.mocked(getClimbTicks);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const climb: Climb = {
  id:          "climb-1",
  name:        "Test Problem",
  grade:       "V5",
  boardId:     "kilter-original",
  boardName:   "Kilter Board (Original)",
  angle:       40,
  description: "",
  author:      "alice",
  sends:       0,
  createdAt:   "2026-01-01T00:00:00.000Z",
  betaVideos:  [],
};

const alice: User = {
  id: "alice", handle: "alice", displayName: "Alice",
  avatarColor: "bg-orange-500", bio: "", homeBoard: "Kilter Board (Original)",
  homeBoardAngle: 40, joinedAt: "2026-01-01T00:00:00.000Z",
  followersCount: 0, followingCount: 0, personalBests: {},
};

const bob: User = {
  ...alice, id: "bob", handle: "bob", displayName: "Bob",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockGetClimbById.mockResolvedValue(climb);
  mockGetClimbTicks.mockResolvedValue([]);
});

afterEach(() => jest.clearAllMocks());

describe("ClimbPage — ownership-gated UI", () => {
  it("shows neither 'Tick this climb' nor 'Edit climb' when logged out", async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: jest.fn(), updateUser: jest.fn() });
    render(<ClimbPage />);
    await screen.findByText("Test Problem");
    expect(screen.queryByText("Tick this climb")).not.toBeInTheDocument();
    expect(screen.queryByText("Edit climb")).not.toBeInTheDocument();
  });

  it("shows 'Tick this climb' but NOT 'Edit climb' for an authenticated non-owner", async () => {
    mockUseAuth.mockReturnValue({ user: bob, loading: false, logout: jest.fn(), updateUser: jest.fn() });
    render(<ClimbPage />);
    await screen.findByText("Test Problem");
    // Any authenticated user may tick a climb
    expect(screen.getByText("Tick this climb")).toBeInTheDocument();
    // Only the author (alice) should see the edit link — bob must not
    expect(screen.queryByText("Edit climb")).not.toBeInTheDocument();
  });

  it("shows both 'Tick this climb' and 'Edit climb' for the climb's author", async () => {
    mockUseAuth.mockReturnValue({ user: alice, loading: false, logout: jest.fn(), updateUser: jest.fn() });
    render(<ClimbPage />);
    await screen.findByText("Test Problem");
    expect(screen.getByText("Tick this climb")).toBeInTheDocument();
    expect(screen.getByText("Edit climb")).toBeInTheDocument();
  });

  it("'Edit climb' is a button (not a navigation link)", async () => {
    mockUseAuth.mockReturnValue({ user: alice, loading: false, logout: jest.fn(), updateUser: jest.fn() });
    render(<ClimbPage />);
    await screen.findByText("Test Problem");
    const btn = screen.getByText("Edit climb");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.closest("a")).toBeNull();
  });
});

describe("ClimbPage — edit modal", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: alice, loading: false, logout: jest.fn(), updateUser: jest.fn() });
  });

  it("does not show the edit modal before 'Edit climb' is clicked", async () => {
    render(<ClimbPage />);
    await screen.findByText("Test Problem");
    expect(screen.queryByTestId("climb-edit-modal")).not.toBeInTheDocument();
  });

  it("opens the edit modal when the author clicks 'Edit climb'", async () => {
    render(<ClimbPage />);
    await screen.findByText("Test Problem");
    fireEvent.click(screen.getByText("Edit climb"));
    expect(screen.getByTestId("climb-edit-modal")).toBeInTheDocument();
    expect(screen.getByText("Edit Climb Modal — Test Problem")).toBeInTheDocument();
  });

  it("closes the edit modal when onClose is called", async () => {
    render(<ClimbPage />);
    await screen.findByText("Test Problem");
    fireEvent.click(screen.getByText("Edit climb"));
    expect(screen.getByTestId("climb-edit-modal")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Close"));
    expect(screen.queryByTestId("climb-edit-modal")).not.toBeInTheDocument();
  });
});
