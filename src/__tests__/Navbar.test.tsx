import { render, screen, fireEvent, act } from "@testing-library/react";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/lib/auth-context";
import type { User } from "@/lib/types";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/db", () => ({
  getInbox: jest.fn().mockResolvedValue({ items: [], unreadCount: 0 }),
  markInboxItemRead: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("next/navigation", () => ({
  usePathname: jest.fn().mockReturnValue("/"),
  useRouter:   jest.fn().mockReturnValue({ push: jest.fn(), replace: jest.fn() }),
}));
jest.mock("next/image", () => ({
  __esModule: true,
  // Strip Next.js-specific props (priority, etc.) that React DOM doesn't accept on <img>
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: ({ priority: _priority, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) =>
    <img {...props} />,
}));

const mockUseAuth = jest.mocked(useAuth);

const mockUser: User = {
  id: "testuser",
  handle: "testuser",
  displayName: "Test User",
  avatarColor: "bg-orange-500",
  bio: "",
  homeBoard: "Kilter Board (Original)",
  homeBoardAngle: 40,
  joinedAt: "2026-01-01T00:00:00.000Z",
  followersCount: 5,
  followingCount: 3,
  personalBests: {},
};

describe("Navbar — authentication states", () => {
  it("shows no Login link while auth state is loading", async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true, logout: jest.fn(), updateUser: jest.fn() });
    await act(async () => { render(<Navbar />); });
    expect(screen.queryByText("Login")).not.toBeInTheDocument();
  });

  it("shows a Login link when the user is logged out", async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: jest.fn(), updateUser: jest.fn() });
    await act(async () => { render(<Navbar />); });
    expect(screen.getByText("Login")).toBeInTheDocument();
  });

  it("renders all primary nav items regardless of auth state", async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: jest.fn(), updateUser: jest.fn() });
    await act(async () => { render(<Navbar />); });
    expect(screen.getByText("Feed")).toBeInTheDocument();
    expect(screen.getByText("Climbs")).toBeInTheDocument();
    expect(screen.getByText("Boards")).toBeInTheDocument();
  });

  it("shows an account menu button and no Login link when logged in", async () => {
    mockUseAuth.mockReturnValue({ user: mockUser, loading: false, logout: jest.fn(), updateUser: jest.fn() });
    await act(async () => { render(<Navbar />); });
    expect(screen.getByLabelText("Account menu")).toBeInTheDocument();
    expect(screen.queryByText("Login")).not.toBeInTheDocument();
  });

  it("opens a dropdown with handle, profile link and logout when avatar is clicked", async () => {
    mockUseAuth.mockReturnValue({ user: mockUser, loading: false, logout: jest.fn(), updateUser: jest.fn() });
    await act(async () => { render(<Navbar />); });
    fireEvent.click(screen.getByLabelText("Account menu"));
    expect(screen.getByText("@testuser")).toBeInTheDocument();
    expect(screen.getByText("View Profile")).toBeInTheDocument();
    expect(screen.getByText("Log out")).toBeInTheDocument();
  });

  it("'View Profile' links to the user's profile page", async () => {
    mockUseAuth.mockReturnValue({ user: mockUser, loading: false, logout: jest.fn(), updateUser: jest.fn() });
    await act(async () => { render(<Navbar />); });
    fireEvent.click(screen.getByLabelText("Account menu"));
    expect(screen.getByText("View Profile").closest("a")).toHaveAttribute("href", "/user/testuser");
  });

  it("calls the logout handler when 'Log out' is clicked", async () => {
    const logout = jest.fn();
    mockUseAuth.mockReturnValue({ user: mockUser, loading: false, logout, updateUser: jest.fn() });
    await act(async () => { render(<Navbar />); });
    fireEvent.click(screen.getByLabelText("Account menu"));
    fireEvent.click(screen.getByText("Log out"));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
