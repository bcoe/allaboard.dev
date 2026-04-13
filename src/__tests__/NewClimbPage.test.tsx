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
