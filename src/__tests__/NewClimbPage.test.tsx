import { render, screen, act } from "@testing-library/react";
import NewClimbPage from "@/app/climbs/new/page";
import { useAuth } from "@/lib/auth-context";
import { useSearchParams } from "next/navigation";
import type { User } from "@/lib/types";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("@/lib/auth-context");
jest.mock("@/lib/db");
jest.mock("next/navigation", () => ({
  useRouter:       jest.fn().mockReturnValue({ replace: jest.fn(), push: jest.fn() }),
  useSearchParams: jest.fn(),
}));

const mockUseAuth         = jest.mocked(useAuth);
const mockUseSearchParams = jest.mocked(useSearchParams);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const loggedInUser: User = {
  id: "alice", handle: "alice", displayName: "Alice",
  avatarColor: "bg-orange-500", bio: "", homeBoard: "Kilter Board",
  homeBoardAngle: 40, joinedAt: "2026-01-01T00:00:00Z",
  followersCount: 0, followingCount: 0, personalBests: {},
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve([]) });
  mockUseAuth.mockReturnValue({ user: loggedInUser, loading: false, logout: jest.fn(), updateUser: jest.fn() });
  mockUseSearchParams.mockReturnValue(
    new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>,
  );
});

// ── Name pre-population ───────────────────────────────────────────────────────

describe("NewClimbPage — name pre-population from ?name= param", () => {
  it("leaves the name field empty when no ?name= param is present", async () => {
    await act(async () => { render(<NewClimbPage />); });
    expect(screen.getByPlaceholderText("e.g. The Crimson Project")).toHaveValue("");
  });

  it("pre-populates the name field from the ?name= query param", async () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams("name=Cobra+Crack") as unknown as ReturnType<typeof useSearchParams>,
    );
    await act(async () => { render(<NewClimbPage />); });
    expect(screen.getByPlaceholderText("e.g. The Crimson Project")).toHaveValue("Cobra Crack");
  });

  it("decodes URL-encoded characters in the pre-populated name", async () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams("name=V%26A+Problem") as unknown as ReturnType<typeof useSearchParams>,
    );
    await act(async () => { render(<NewClimbPage />); });
    expect(screen.getByPlaceholderText("e.g. The Crimson Project")).toHaveValue("V&A Problem");
  });
});

// ── Board pre-selection ───────────────────────────────────────────────────────

const twoBoards = [
  { id: "kilter",    name: "Kilter Board",    type: "standard", relativeDifficulty: 1.5 },
  { id: "moonboard", name: "Moonboard 2016",  type: "standard", relativeDifficulty: 1.2 },
];

describe("NewClimbPage — board pre-selection", () => {
  it("pre-selects the board from ?boardId= when it matches a loaded board", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve(twoBoards) });
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams("boardId=moonboard") as unknown as ReturnType<typeof useSearchParams>,
    );
    await act(async () => { render(<NewClimbPage />); });
    expect(screen.getByRole("radio", { name: "Moonboard 2016" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Kilter Board" })).not.toBeChecked();
  });

  it("falls back to the user's home board when no ?boardId= param is present", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve(twoBoards) });
    // no boardId param — default fetch returns both boards; user.homeBoard = "Kilter Board"
    await act(async () => { render(<NewClimbPage />); });
    expect(screen.getByRole("radio", { name: "Kilter Board" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Moonboard 2016" })).not.toBeChecked();
  });

  it("ignores an unrecognised ?boardId= and falls back to the user's home board", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve(twoBoards) });
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams("boardId=unknown-board") as unknown as ReturnType<typeof useSearchParams>,
    );
    await act(async () => { render(<NewClimbPage />); });
    expect(screen.getByRole("radio", { name: "Kilter Board" })).toBeChecked();
  });
});
