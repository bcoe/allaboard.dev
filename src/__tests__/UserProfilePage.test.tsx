import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import UserProfilePage from "@/app/user/[handle]/page";
import { useAuth } from "@/lib/auth-context";
import {
  getUserById,
  getUserTicks,
  getFollowers,
  getFollowing,
  checkFollowing,
  followUser,
  unfollowUser,
  importAuroraData,
  importMoonboardData,
} from "@/lib/db";
import type { User } from "@/lib/types";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/db");
jest.mock("@/components/TickModal", () => ({ __esModule: true, default: () => null }));
jest.mock("next/navigation", () => ({
  useParams: jest.fn().mockReturnValue({ handle: "targetuser" }),
}));

const mockUseAuth = jest.mocked(useAuth);
const mockGetUserById = jest.mocked(getUserById);
const mockGetUserTicks = jest.mocked(getUserTicks);
const mockGetFollowers = jest.mocked(getFollowers);
const mockGetFollowing = jest.mocked(getFollowing);
const mockCheckFollowing = jest.mocked(checkFollowing);
const mockFollowUser = jest.mocked(followUser);
const mockUnfollowUser = jest.mocked(unfollowUser);
const mockImportAuroraData = jest.mocked(importAuroraData);
const mockImportMoonboardData = jest.mocked(importMoonboardData);

const targetUser: User = {
  id: "targetuser",
  handle: "targetuser",
  displayName: "Target User",
  avatarColor: "bg-orange-500",
  bio: "I love climbing",
  homeBoard: "Kilter Board (Original)",
  homeBoardAngle: 40,
  joinedAt: "2026-01-01T00:00:00.000Z",
  followersCount: 12,
  followingCount: 5,
  personalBests: {},
};

const otherUser: User = {
  id: "otheruser",
  handle: "otheruser",
  displayName: "Other User",
  avatarColor: "bg-blue-500",
  bio: "",
  homeBoard: "Kilter Board (Original)",
  homeBoardAngle: 40,
  joinedAt: "2026-01-01T00:00:00.000Z",
  followersCount: 0,
  followingCount: 0,
  personalBests: {},
};

beforeEach(() => {
  mockGetUserById.mockResolvedValue(targetUser);
  mockGetUserTicks.mockResolvedValue([]);
  mockGetFollowers.mockResolvedValue([]);
  mockGetFollowing.mockResolvedValue([]);
  mockCheckFollowing.mockResolvedValue(false);
  mockFollowUser.mockResolvedValue(undefined);
  mockUnfollowUser.mockResolvedValue(undefined);
  global.fetch = jest.fn().mockResolvedValue({
    json: () => Promise.resolve([
      { id: "kilter-original", name: "Kilter Board (Original)", type: "standard" },
    ]),
  });
});

describe("UserProfilePage — profile display", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: jest.fn(), updateUser: jest.fn() });
  });

  it("shows the user's handle as the page title", async () => {
    render(<UserProfilePage />);
    expect(await screen.findByText("@targetuser")).toBeInTheDocument();
  });

  it("shows the user's bio", async () => {
    render(<UserProfilePage />);
    expect(await screen.findByText("I love climbing")).toBeInTheDocument();
  });

  it("shows the followers count in the stat tiles", async () => {
    render(<UserProfilePage />);
    await screen.findByText("@targetuser");
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Followers")).toBeInTheDocument();
  });

  it("renders Ticks, Followers, and Following tabs with counts", async () => {
    render(<UserProfilePage />);
    await screen.findByText("@targetuser");
    // Tab labels include counts — e.g. "Ticks (0)", "Followers (12)", "Following (5)"
    expect(screen.getByText("Ticks (0)")).toBeInTheDocument();
    expect(screen.getByText("Followers (12)")).toBeInTheDocument();
    expect(screen.getByText("Following (5)")).toBeInTheDocument();
  });

  it("shows 'No ticks yet.' when the tick list is empty", async () => {
    render(<UserProfilePage />);
    await screen.findByText("@targetuser");
    expect(screen.getByText("No ticks yet.")).toBeInTheDocument();
  });
});

describe("UserProfilePage — own profile", () => {
  beforeEach(() => {
    // Current user is the profile being viewed
    mockUseAuth.mockReturnValue({ user: targetUser, loading: false, logout: jest.fn(), updateUser: jest.fn() });
  });

  it("does not show a Follow or Unfollow button on your own profile", async () => {
    render(<UserProfilePage />);
    await screen.findByText("@targetuser");
    expect(screen.queryByText("Follow")).not.toBeInTheDocument();
    expect(screen.queryByText("Unfollow")).not.toBeInTheDocument();
  });

  it("shows the Detailed Stats link on your own profile", async () => {
    render(<UserProfilePage />);
    expect(await screen.findByText("Detailed Stats")).toBeInTheDocument();
  });

  it("shows an Unfollow button in the Following list on your own profile", async () => {
    mockGetFollowing.mockResolvedValue([otherUser]);
    render(<UserProfilePage />);
    await screen.findByText("@targetuser");
    fireEvent.click(screen.getByText("Following (5)"));
    expect(await screen.findByText("Unfollow")).toBeInTheDocument();
  });

  it("removes a user from the Following list after clicking Unfollow", async () => {
    mockGetFollowing.mockResolvedValue([otherUser]);
    render(<UserProfilePage />);
    await screen.findByText("@targetuser");
    fireEvent.click(screen.getByText("Following (5)"));
    fireEvent.click(await screen.findByText("Unfollow"));
    await waitFor(() =>
      expect(screen.queryByText("Other User")).not.toBeInTheDocument()
    );
    expect(mockUnfollowUser).toHaveBeenCalledWith("otheruser");
  });
});

describe("UserProfilePage — viewing another user's profile", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: otherUser, loading: false, logout: jest.fn(), updateUser: jest.fn() });
  });

  it("shows a Follow button when not yet following", async () => {
    mockCheckFollowing.mockResolvedValue(false);
    render(<UserProfilePage />);
    expect(await screen.findByText("Follow")).toBeInTheDocument();
  });

  it("shows an Unfollow button when already following", async () => {
    mockCheckFollowing.mockResolvedValue(true);
    render(<UserProfilePage />);
    expect(await screen.findByText("Unfollow")).toBeInTheDocument();
  });

  it("shows the Detailed Stats link on another user's profile", async () => {
    render(<UserProfilePage />);
    expect(await screen.findByText("Detailed Stats")).toBeInTheDocument();
  });

  it("calls followUser and switches button to Unfollow when Follow is clicked", async () => {
    mockCheckFollowing.mockResolvedValue(false);
    render(<UserProfilePage />);
    fireEvent.click(await screen.findByText("Follow"));
    await waitFor(() => expect(mockFollowUser).toHaveBeenCalledWith("targetuser"));
    expect(await screen.findByText("Unfollow")).toBeInTheDocument();
  });

  it("calls unfollowUser and switches button to Follow when Unfollow is clicked", async () => {
    mockCheckFollowing.mockResolvedValue(true);
    render(<UserProfilePage />);
    fireEvent.click(await screen.findByText("Unfollow"));
    await waitFor(() => expect(mockUnfollowUser).toHaveBeenCalledWith("targetuser"));
    expect(await screen.findByText("Follow")).toBeInTheDocument();
  });
});

describe("UserProfilePage — followers list", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: jest.fn(), updateUser: jest.fn() });
  });

  it("shows followers after clicking the Followers tab", async () => {
    mockGetFollowers.mockResolvedValue([otherUser]);
    render(<UserProfilePage />);
    await screen.findByText("@targetuser");
    fireEvent.click(screen.getByText("Followers (12)"));
    expect(await screen.findByText("Other User")).toBeInTheDocument();
  });

  it("shows 'No followers yet.' when the list is empty", async () => {
    render(<UserProfilePage />);
    await screen.findByText("@targetuser");
    fireEvent.click(screen.getByText("Followers (12)"));
    expect(screen.getByText("No followers yet.")).toBeInTheDocument();
  });
});

// ── Aurora import section ─────────────────────────────────────────────────────

/** Returns the hidden file input inside the Aurora import label. */
function getFileInput(): HTMLInputElement {
  // Scope to the Aurora card div so the query is unambiguous when multiple
  // importer cards are rendered inside the same <section>.
  const card = screen.getByText("Upload Aurora Kilter Data").closest("div")!.parentElement!;
  return within(card as HTMLElement)
    .getByText(/choose json file/i)
    .querySelector("input[type='file']")! as HTMLInputElement;
}

/** Returns the hidden file input inside the Moonboard import label. */
function getMoonboardFileInput(): HTMLInputElement {
  const card = screen.getByText("Upload Moonboard Data").closest("div")!.parentElement!;
  return within(card as HTMLElement)
    .getByText(/choose json file/i)
    .querySelector("input[type='file']")! as HTMLInputElement;
}

/**
 * Simulate selecting a file in jsdom.  jsdom does not implement Blob/File.text(),
 * so we stub the input's `files` property with a plain object that provides
 * the text() method, then fire the change event.
 */
function selectFile(input: HTMLInputElement, content: string, name = "aurora.json") {
  const mockFile = { text: () => Promise.resolve(content), name, type: "application/json" };
  Object.defineProperty(input, "files", { value: [mockFile], configurable: true });
  fireEvent.change(input);
}

describe("UserProfilePage — Aurora import section", () => {
  const auroraJson = JSON.stringify({ ascents: [{ climb: "Test", angle: 40, grade: "7a" }] });

  beforeEach(() => {
    mockImportAuroraData.mockReset();
    // Own profile so the import section renders
    mockUseAuth.mockReturnValue({
      user: targetUser,
      loading: false,
      logout: jest.fn(),
      updateUser: jest.fn(),
    });
  });

  it("renders the Import Data section on the owner's profile", async () => {
    render(<UserProfilePage />);
    expect(await screen.findByText("Import Data")).toBeInTheDocument();
    expect(screen.getByText("Upload Aurora Kilter Data")).toBeInTheDocument();
  });

  it("does not render the Import Data section on another user's profile", async () => {
    mockUseAuth.mockReturnValue({
      user: otherUser,
      loading: false,
      logout: jest.fn(),
      updateUser: jest.fn(),
    });
    render(<UserProfilePage />);
    await screen.findByText("@targetuser");
    expect(screen.queryByText("Import Data")).not.toBeInTheDocument();
  });

  it("shows 'Import complete' and all three stat rows after a successful import", async () => {
    // Use values where no top-level count collides with a breakdown sub-count.
    mockImportAuroraData.mockResolvedValue({
      imported: 7, climbsCreated: 3, skipped: 0,
      skipDetails: { alreadyImported: 0, unknownGrade: 0, missingName: 0, invalidAngle: 0 },
    });

    render(<UserProfilePage />);
    await screen.findByText("Import Data");
    selectFile(getFileInput(), auroraJson);

    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(screen.getByText("Ticks added")).toBeInTheDocument();
    expect(screen.getByText("Climbs created")).toBeInTheDocument();
    expect(screen.getByText("Ticks skipped")).toBeInTheDocument();
  });

  it("shows all stat rows even when counts are zero", async () => {
    mockImportAuroraData.mockResolvedValue({
      imported: 0, climbsCreated: 0, skipped: 3,
      skipDetails: { alreadyImported: 3, unknownGrade: 0, missingName: 0, invalidAngle: 0 },
    });

    render(<UserProfilePage />);
    await screen.findByText("Import Data");
    selectFile(getFileInput(), auroraJson);

    await screen.findByText("Import complete");
    // All three rows always rendered regardless of zero values
    expect(screen.getByText("Ticks added")).toBeInTheDocument();
    expect(screen.getByText("Climbs created")).toBeInTheDocument();
    expect(screen.getByText("Ticks skipped")).toBeInTheDocument();
  });

  it("shows an error message when the import API call fails", async () => {
    mockImportAuroraData.mockRejectedValue(new Error("network error"));

    render(<UserProfilePage />);
    await screen.findByText("Import Data");
    selectFile(getFileInput(), auroraJson);

    expect(await screen.findByText("Import failed. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText("Import complete")).not.toBeInTheDocument();
  });

  it("shows a parse error when the selected file contains invalid JSON", async () => {
    render(<UserProfilePage />);
    await screen.findByText("Import Data");
    selectFile(getFileInput(), "not valid json {{{");

    expect(
      await screen.findByText("Could not parse file — make sure it is valid JSON.")
    ).toBeInTheDocument();
    expect(mockImportAuroraData).not.toHaveBeenCalled();
  });

  it("calls importAuroraData with the profile handle and parsed file contents", async () => {
    mockImportAuroraData.mockResolvedValue({
      imported: 1, climbsCreated: 0, skipped: 0,
      skipDetails: { alreadyImported: 0, unknownGrade: 0, missingName: 0, invalidAngle: 0 },
    });

    render(<UserProfilePage />);
    await screen.findByText("Import Data");

    const payload = { ascents: [{ climb: "Test", angle: 40, grade: "7a" }] };
    selectFile(getFileInput(), JSON.stringify(payload));

    await screen.findByText("Import complete");
    expect(mockImportAuroraData).toHaveBeenCalledWith("targetuser", payload);
  });

  it("shows skip reason breakdown rows for each non-zero reason", async () => {
    mockImportAuroraData.mockResolvedValue({
      imported: 1, climbsCreated: 0, skipped: 4,
      skipDetails: { alreadyImported: 2, unknownGrade: 1, missingName: 1, invalidAngle: 0 },
    });

    render(<UserProfilePage />);
    await screen.findByText("Import Data");
    selectFile(getFileInput(), auroraJson);

    await screen.findByText("Import complete");
    expect(screen.getByText("Already imported (same climb, same day)")).toBeInTheDocument();
    expect(screen.getByText("Unrecognised Font grade")).toBeInTheDocument();
    expect(screen.getByText("Missing climb name")).toBeInTheDocument();
    // invalidAngle is 0, so its row should NOT appear
    expect(screen.queryByText("Invalid angle")).not.toBeInTheDocument();
  });

  it("shows no skip breakdown when skipped is zero", async () => {
    mockImportAuroraData.mockResolvedValue({
      imported: 3, climbsCreated: 1, skipped: 0,
      skipDetails: { alreadyImported: 0, unknownGrade: 0, missingName: 0, invalidAngle: 0 },
    });

    render(<UserProfilePage />);
    await screen.findByText("Import Data");
    selectFile(getFileInput(), auroraJson);

    await screen.findByText("Import complete");
    expect(screen.queryByText("Already imported (same climb, same day)")).not.toBeInTheDocument();
    expect(screen.queryByText("Unrecognised Font grade")).not.toBeInTheDocument();
  });
});

// ── Moonboard import section ──────────────────────────────────────────────────

describe("UserProfilePage — Moonboard import section", () => {
  const moonboardJson = JSON.stringify({
    entries: [{ id: 1, data: { Data: [{ Problem: { Name: "Test", Grade: "7A" }, DateClimbed: "/Date(1700000000000)/", NumberOfTries: 1 }] } }],
  });

  beforeEach(() => {
    mockImportMoonboardData.mockReset();
    mockUseAuth.mockReturnValue({
      user: targetUser,
      loading: false,
      logout: jest.fn(),
      updateUser: jest.fn(),
    });
  });

  it("renders the Moonboard import card on the owner's profile", async () => {
    render(<UserProfilePage />);
    expect(await screen.findByText("Upload Moonboard Data")).toBeInTheDocument();
  });

  it("does not render the Moonboard import card on another user's profile", async () => {
    mockUseAuth.mockReturnValue({
      user: otherUser,
      loading: false,
      logout: jest.fn(),
      updateUser: jest.fn(),
    });
    render(<UserProfilePage />);
    await screen.findByText("@targetuser");
    expect(screen.queryByText("Upload Moonboard Data")).not.toBeInTheDocument();
  });

  it("shows 'Import complete' and core stat rows after a successful import", async () => {
    mockImportMoonboardData.mockResolvedValue({
      imported: 5, climbsCreated: 2, boardsCreated: 0, skipped: 0,
      skipDetails: { alreadyImported: 0, unknownGrade: 0, missingName: 0, notSent: 0 },
    });

    render(<UserProfilePage />);
    await screen.findByText("Upload Moonboard Data");
    selectFile(getMoonboardFileInput(), moonboardJson);

    const section = (await screen.findAllByText("Import complete"))[0].closest("div")!;
    expect(within(section).getByText("Ticks added")).toBeInTheDocument();
    expect(within(section).getByText("Climbs created")).toBeInTheDocument();
    expect(within(section).getByText("Ticks skipped")).toBeInTheDocument();
  });

  it("shows 'Boards created' row only when boardsCreated is non-zero", async () => {
    mockImportMoonboardData.mockResolvedValue({
      imported: 3, climbsCreated: 1, boardsCreated: 1, skipped: 0,
      skipDetails: { alreadyImported: 0, unknownGrade: 0, missingName: 0, notSent: 0 },
    });

    render(<UserProfilePage />);
    await screen.findByText("Upload Moonboard Data");
    selectFile(getMoonboardFileInput(), moonboardJson);

    await screen.findByText("Boards created");
    expect(screen.getByText("Boards created")).toBeInTheDocument();
  });

  it("hides 'Boards created' row when boardsCreated is zero", async () => {
    mockImportMoonboardData.mockResolvedValue({
      imported: 3, climbsCreated: 1, boardsCreated: 0, skipped: 0,
      skipDetails: { alreadyImported: 0, unknownGrade: 0, missingName: 0, notSent: 0 },
    });

    render(<UserProfilePage />);
    await screen.findByText("Upload Moonboard Data");
    selectFile(getMoonboardFileInput(), moonboardJson);

    await screen.findAllByText("Import complete");
    expect(screen.queryByText("Boards created")).not.toBeInTheDocument();
  });

  it("shows skip reason breakdown rows for each non-zero reason", async () => {
    mockImportMoonboardData.mockResolvedValue({
      imported: 1, climbsCreated: 0, boardsCreated: 0, skipped: 5,
      skipDetails: { alreadyImported: 2, unknownGrade: 1, missingName: 1, notSent: 1 },
    });

    render(<UserProfilePage />);
    await screen.findByText("Upload Moonboard Data");
    selectFile(getMoonboardFileInput(), moonboardJson);

    await screen.findAllByText("Import complete");
    expect(screen.getByText("Projects (not sent)")).toBeInTheDocument();
    expect(screen.getAllByText("Already imported (same climb, same day)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unrecognised Font grade").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Missing climb name").length).toBeGreaterThan(0);
  });

  it("shows no skip breakdown when skipped is zero", async () => {
    mockImportMoonboardData.mockResolvedValue({
      imported: 4, climbsCreated: 0, boardsCreated: 0, skipped: 0,
      skipDetails: { alreadyImported: 0, unknownGrade: 0, missingName: 0, notSent: 0 },
    });

    render(<UserProfilePage />);
    await screen.findByText("Upload Moonboard Data");
    selectFile(getMoonboardFileInput(), moonboardJson);

    await screen.findAllByText("Import complete");
    expect(screen.queryByText("Projects (not sent)")).not.toBeInTheDocument();
  });

  it("calls importMoonboardData with the profile handle and parsed file contents", async () => {
    mockImportMoonboardData.mockResolvedValue({
      imported: 1, climbsCreated: 0, boardsCreated: 0, skipped: 0,
      skipDetails: { alreadyImported: 0, unknownGrade: 0, missingName: 0, notSent: 0 },
    });

    render(<UserProfilePage />);
    await screen.findByText("Upload Moonboard Data");

    const payload = JSON.parse(moonboardJson);
    selectFile(getMoonboardFileInput(), moonboardJson);

    await screen.findAllByText("Import complete");
    expect(mockImportMoonboardData).toHaveBeenCalledWith("targetuser", payload);
  });

  it("shows an error message when the import API call fails", async () => {
    mockImportMoonboardData.mockRejectedValue(new Error("network error"));

    render(<UserProfilePage />);
    await screen.findByText("Upload Moonboard Data");
    selectFile(getMoonboardFileInput(), moonboardJson);

    expect(await screen.findAllByText("Import failed. Please try again.")).toHaveLength(1);
  });

  it("shows a parse error when the selected file contains invalid JSON", async () => {
    render(<UserProfilePage />);
    await screen.findByText("Upload Moonboard Data");
    selectFile(getMoonboardFileInput(), "not valid json {{{");

    expect(
      await screen.findByText("Could not parse file — make sure it is valid JSON.")
    ).toBeInTheDocument();
    expect(mockImportMoonboardData).not.toHaveBeenCalled();
  });
});
