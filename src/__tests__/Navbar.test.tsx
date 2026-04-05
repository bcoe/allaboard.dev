import { render, screen, fireEvent } from "@testing-library/react";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/lib/auth-context";
import type { User } from "@/lib/types";

jest.mock("@/lib/auth-context");
jest.mock("next/navigation", () => ({
  usePathname: jest.fn().mockReturnValue("/"),
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
  it("shows no Login link while auth state is loading", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true, logout: jest.fn(), updateUser: jest.fn() });
    render(<Navbar />);
    expect(screen.queryByText("Login")).not.toBeInTheDocument();
  });

  it("shows a Login link when the user is logged out", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: jest.fn(), updateUser: jest.fn() });
    render(<Navbar />);
    expect(screen.getByText("Login")).toBeInTheDocument();
  });

  it("renders all primary nav items regardless of auth state", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, logout: jest.fn(), updateUser: jest.fn() });
    render(<Navbar />);
    expect(screen.getByText("Feed")).toBeInTheDocument();
    expect(screen.getByText("Climbs")).toBeInTheDocument();
    expect(screen.getByText("Boards")).toBeInTheDocument();
  });

  it("shows an account menu button and no Login link when logged in", () => {
    mockUseAuth.mockReturnValue({ user: mockUser, loading: false, logout: jest.fn(), updateUser: jest.fn() });
    render(<Navbar />);
    expect(screen.getByLabelText("Account menu")).toBeInTheDocument();
    expect(screen.queryByText("Login")).not.toBeInTheDocument();
  });

  it("opens a dropdown with handle, profile link and logout when avatar is clicked", () => {
    mockUseAuth.mockReturnValue({ user: mockUser, loading: false, logout: jest.fn(), updateUser: jest.fn() });
    render(<Navbar />);
    fireEvent.click(screen.getByLabelText("Account menu"));
    expect(screen.getByText("@testuser")).toBeInTheDocument();
    expect(screen.getByText("View Profile")).toBeInTheDocument();
    expect(screen.getByText("Log out")).toBeInTheDocument();
  });

  it("'View Profile' links to the user's profile page", () => {
    mockUseAuth.mockReturnValue({ user: mockUser, loading: false, logout: jest.fn(), updateUser: jest.fn() });
    render(<Navbar />);
    fireEvent.click(screen.getByLabelText("Account menu"));
    expect(screen.getByText("View Profile").closest("a")).toHaveAttribute("href", "/user/testuser");
  });

  it("calls the logout handler when 'Log out' is clicked", () => {
    const logout = jest.fn();
    mockUseAuth.mockReturnValue({ user: mockUser, loading: false, logout, updateUser: jest.fn() });
    render(<Navbar />);
    fireEvent.click(screen.getByLabelText("Account menu"));
    fireEvent.click(screen.getByText("Log out"));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
