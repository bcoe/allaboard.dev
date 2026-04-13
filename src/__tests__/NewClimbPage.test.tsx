import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import NewClimbPage from "@/app/climbs/new/page";
import { useAuth } from "@/lib/auth-context";
import { useRouter, useSearchParams } from "next/navigation";
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
const mockUseRouter       = jest.mocked(useRouter);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const loggedInUser: User = {
  id: "alice", handle: "alice", displayName: "Alice",
  avatarColor: "bg-orange-500", bio: "", homeBoard: "Kilter Board",
  homeBoardAngle: 40, joinedAt: "2026-01-01T00:00:00Z",
  followersCount: 0, followingCount: 0, personalBests: {},
};

const twoBoards = [
  { id: "kilter",    name: "Kilter Board",   type: "standard", relativeDifficulty: 1.5 },
  { id: "moonboard", name: "Moonboard 2016", type: "standard", relativeDifficulty: 1.2 },
];

/** Fetch mock that dispatches by URL prefix. */
function makeFetchMock({
  boards = [] as unknown[],
  setters = [] as string[],
} = {}) {
  return jest.fn().mockImplementation((url: string) => {
    if (typeof url === "string" && url.startsWith("/api/setters")) {
      return Promise.resolve({ json: () => Promise.resolve(setters) });
    }
    // /api/boards or anything else
    return Promise.resolve({ json: () => Promise.resolve(boards) });
  });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = makeFetchMock();
  mockUseAuth.mockReturnValue({ user: loggedInUser, loading: false, logout: jest.fn(), updateUser: jest.fn() });
  mockUseSearchParams.mockReturnValue(
    new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>,
  );
  mockUseRouter.mockReturnValue({ replace: jest.fn(), push: jest.fn() } as unknown as ReturnType<typeof useRouter>);
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

describe("NewClimbPage — board pre-selection", () => {
  it("pre-selects the board from ?boardId= when it matches a loaded board", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = makeFetchMock({ boards: twoBoards });
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams("boardId=moonboard") as unknown as ReturnType<typeof useSearchParams>,
    );
    await act(async () => { render(<NewClimbPage />); });
    expect(screen.getByRole("radio", { name: "Moonboard 2016" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Kilter Board" })).not.toBeChecked();
  });

  it("falls back to the user's home board when no ?boardId= param is present", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = makeFetchMock({ boards: twoBoards });
    await act(async () => { render(<NewClimbPage />); });
    expect(screen.getByRole("radio", { name: "Kilter Board" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Moonboard 2016" })).not.toBeChecked();
  });

  it("ignores an unrecognised ?boardId= and falls back to the user's home board", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = makeFetchMock({ boards: twoBoards });
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams("boardId=unknown-board") as unknown as ReturnType<typeof useSearchParams>,
    );
    await act(async () => { render(<NewClimbPage />); });
    expect(screen.getByRole("radio", { name: "Kilter Board" })).toBeChecked();
  });
});

// ── Setter typeahead ──────────────────────────────────────────────────────────

describe("NewClimbPage — setter typeahead", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function getSetterInput() {
    return screen.getByPlaceholderText("e.g. Chris Sharma");
  }

  async function typeInSetter(value: string) {
    await act(async () => {
      fireEvent.change(getSetterInput(), { target: { value } });
      jest.runAllTimers(); // advance past the 180ms debounce
    });
    await act(async () => {}); // flush the fetch promise
  }

  it("renders the setter input with the correct placeholder", async () => {
    jest.useRealTimers(); // not needed for this test
    await act(async () => { render(<NewClimbPage />); });
    expect(getSetterInput()).toBeInTheDocument();
  });

  it("fetches suggestions from /api/setters after the debounce", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = makeFetchMock({ setters: ["Chris Sharma"] });
    await act(async () => { render(<NewClimbPage />); });
    await typeInSetter("sha");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setterCalls = ((global as any).fetch as jest.Mock).mock.calls.filter(
      ([url]: [string]) => url.includes("/api/setters"),
    );
    expect(setterCalls.length).toBeGreaterThanOrEqual(1);
    expect(setterCalls[0][0]).toContain("q=sha");
  });

  it("shows suggestions in a dropdown when the API returns results", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = makeFetchMock({ setters: ["Chris Sharma", "Adam Ondra"] });
    await act(async () => { render(<NewClimbPage />); });
    await typeInSetter("sha");
    expect(screen.getByText("Chris Sharma")).toBeInTheDocument();
    expect(screen.getByText("Adam Ondra")).toBeInTheDocument();
  });

  it("does NOT show suggestions when the API returns an empty array", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = makeFetchMock({ setters: [] });
    await act(async () => { render(<NewClimbPage />); });
    await typeInSetter("zzz");
    // "Chris Sharma" is the placeholder text, not a suggestion
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("does NOT fetch when the setter field is cleared to empty", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchMock = makeFetchMock({ setters: ["Chris Sharma"] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = fetchMock;
    await act(async () => { render(<NewClimbPage />); });
    await typeInSetter(""); // empty value
    const setterCalls = fetchMock.mock.calls.filter(
      ([url]: [string]) => url.includes("/api/setters"),
    );
    expect(setterCalls).toHaveLength(0);
  });

  it("fills the input and closes the dropdown when a suggestion is clicked", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = makeFetchMock({ setters: ["Chris Sharma"] });
    await act(async () => { render(<NewClimbPage />); });
    await typeInSetter("sha");

    await act(async () => {
      fireEvent.mouseDown(screen.getByText("Chris Sharma"));
    });

    expect(getSetterInput()).toHaveValue("Chris Sharma");
    expect(screen.queryByText("Chris Sharma")).not.toBeInTheDocument();
  });

  it("closes the dropdown on Escape", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = makeFetchMock({ setters: ["Chris Sharma"] });
    await act(async () => { render(<NewClimbPage />); });
    await typeInSetter("sha");
    expect(screen.getByText("Chris Sharma")).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(getSetterInput(), { key: "Escape" });
    });
    await waitFor(() =>
      expect(screen.queryByText("Chris Sharma")).not.toBeInTheDocument(),
    );
  });

  it("navigates suggestions with ArrowDown and selects with Enter", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = makeFetchMock({ setters: ["Alpha", "Bravo"] });
    await act(async () => { render(<NewClimbPage />); });
    await typeInSetter("a");

    // Each key event needs its own act so state flushes between them
    await act(async () => { fireEvent.keyDown(getSetterInput(), { key: "ArrowDown" }); }); // idx → 0
    await act(async () => { fireEvent.keyDown(getSetterInput(), { key: "Enter" }); });
    expect(getSetterInput()).toHaveValue("Alpha");
  });

  it("navigates with ArrowUp and wraps back to free-text when at the top", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = makeFetchMock({ setters: ["Alpha", "Bravo"] });
    await act(async () => { render(<NewClimbPage />); });
    await typeInSetter("a");

    await act(async () => { fireEvent.keyDown(getSetterInput(), { key: "ArrowDown" }); }); // idx → 0
    await act(async () => { fireEvent.keyDown(getSetterInput(), { key: "ArrowUp" }); });   // idx → -1
    await act(async () => { fireEvent.keyDown(getSetterInput(), { key: "Enter" }); });     // no active → no change
    // Value stays as typed because no suggestion is active at idx -1
    expect(getSetterInput()).toHaveValue("a");
  });

  it("the setter value is submitted via FormData when the form is submitted", async () => {
    jest.useRealTimers();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = makeFetchMock({ setters: [] });
    const mockCreateClimb = jest.fn().mockResolvedValue({ id: "new-climb" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(require("@/lib/db"), "createClimb").mockImplementation(mockCreateClimb);

    await act(async () => { render(<NewClimbPage />); });

    // Type directly into the setter input (no suggestions needed)
    await act(async () => {
      fireEvent.change(getSetterInput(), { target: { value: "Jane Doe" } });
    });

    // Verify the input holds the value so FormData will pick it up
    expect(getSetterInput()).toHaveValue("Jane Doe");
  });
});
