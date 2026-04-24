/**
 * Unit tests for the CommentSection component.
 *
 * Covers:
 * - Loading state while getTickComments is pending
 * - Comments rendered after data resolves
 * - Comment form visible only when logged in
 * - Reply button visible to any logged-in user; hidden when logged out
 * - Delete button visible only to the comment owner
 * - Top-level comment submission calls postComment and appends to the list
 * - Reply submission nests the new comment under its parent (addToTree)
 * - Deleting a top-level comment removes it from the list (removeFromTree)
 * - Deleting a nested reply removes it from the subtree only
 * - Highlighted comment receives the highlight class
 */

import { render, screen, fireEvent, act } from "@testing-library/react";
import CommentSection from "@/components/CommentSection";
import { useAuth } from "@/lib/auth-context";
import { getTickComments, postComment, deleteComment } from "@/lib/db";
import type { Comment, User } from "@/lib/types";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("@/lib/auth-context");
jest.mock("@/lib/db");
jest.mock("@/lib/utils", () => ({ timeAgo: () => "just now" }));
jest.mock("@/components/UserAvatar", () => ({ __esModule: true, default: () => null }));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// jsdom does not implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = jest.fn();

const mockUseAuth          = jest.mocked(useAuth);
const mockGetTickComments  = jest.mocked(getTickComments);
const mockPostComment      = jest.mocked(postComment);
const mockDeleteComment    = jest.mocked(deleteComment);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const alice: User = {
  id: "alice", handle: "alice", displayName: "Alice",
  avatarColor: "bg-orange-500", bio: "", homeBoard: "Kilter Board (Original)",
  homeBoardAngle: 40, joinedAt: "2026-01-01T00:00:00.000Z",
  followersCount: 0, followingCount: 0, personalBests: {},
};

const bob: User = { ...alice, id: "bob", handle: "bob", displayName: "Bob" };

function makeComment(overrides: Partial<Comment> & Pick<Comment, "id">): Comment {
  return {
    tickId: "tick-1",
    userId: "alice",
    userHandle: "alice",
    userDisplayName: "Alice",
    userAvatarColor: "bg-orange-500",
    body: "A comment",
    createdAt: "2026-04-23T10:00:00.000Z",
    replies: [],
    ...overrides,
  };
}

const commentA = makeComment({ id: "c-1", body: "Top level" });
const commentB = makeComment({ id: "c-2", userId: "bob", userHandle: "bob", userDisplayName: "Bob", body: "Reply to A" });

const noAuth  = () => ({ user: null,  loading: false, logout: jest.fn(), updateUser: jest.fn() });
const asAlice = () => ({ user: alice, loading: false, logout: jest.fn(), updateUser: jest.fn() });
const asBob   = () => ({ user: bob,   loading: false, logout: jest.fn(), updateUser: jest.fn() });

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockGetTickComments.mockResolvedValue([]);
});

// ── Loading state ─────────────────────────────────────────────────────────────

describe("CommentSection — loading state", () => {
  it("shows a loading indicator while comments are being fetched", () => {
    mockUseAuth.mockReturnValue(noAuth());
    // Never resolves — keeps the component in the loading state
    mockGetTickComments.mockReturnValue(new Promise(() => {}));
    render(<CommentSection tickId="tick-1" />);
    expect(screen.getByText(/loading comments/i)).toBeInTheDocument();
  });
});

// ── Comment rendering ─────────────────────────────────────────────────────────

describe("CommentSection — comment rendering", () => {
  it("shows 'No comments yet.' when the list is empty and user is logged out", async () => {
    mockUseAuth.mockReturnValue(noAuth());
    mockGetTickComments.mockResolvedValue([]);
    render(<CommentSection tickId="tick-1" />);
    expect(await screen.findByText("No comments yet.")).toBeInTheDocument();
  });

  it("renders the comment body after data loads", async () => {
    mockUseAuth.mockReturnValue(noAuth());
    mockGetTickComments.mockResolvedValue([commentA]);
    render(<CommentSection tickId="tick-1" />);
    expect(await screen.findByText("Top level")).toBeInTheDocument();
  });

  it("renders the commenter's handle as a link", async () => {
    mockUseAuth.mockReturnValue(noAuth());
    mockGetTickComments.mockResolvedValue([commentA]);
    render(<CommentSection tickId="tick-1" />);
    await screen.findByText("Top level");
    const link = screen.getByText("@alice");
    expect(link.closest("a")).toHaveAttribute("href", "/user/alice");
  });

  it("renders a nested reply under its parent", async () => {
    const withReply = { ...commentA, replies: [commentB] };
    mockUseAuth.mockReturnValue(noAuth());
    mockGetTickComments.mockResolvedValue([withReply]);
    render(<CommentSection tickId="tick-1" />);
    await screen.findByText("Top level");
    expect(screen.getByText("Reply to A")).toBeInTheDocument();
  });
});

// ── Auth-gated UI ─────────────────────────────────────────────────────────────

describe("CommentSection — auth-gated UI", () => {
  it("does not show the comment input when logged out", async () => {
    mockUseAuth.mockReturnValue(noAuth());
    render(<CommentSection tickId="tick-1" />);
    await screen.findByText("No comments yet.");
    expect(screen.queryByPlaceholderText(/add a comment/i)).not.toBeInTheDocument();
  });

  it("shows the comment input when logged in", async () => {
    mockUseAuth.mockReturnValue(asAlice());
    render(<CommentSection tickId="tick-1" />);
    expect(await screen.findByPlaceholderText(/add a comment/i)).toBeInTheDocument();
  });

  it("shows the Reply button for every comment when logged in", async () => {
    const withReply = { ...commentA, replies: [commentB] };
    mockUseAuth.mockReturnValue(asAlice());
    mockGetTickComments.mockResolvedValue([withReply]);
    render(<CommentSection tickId="tick-1" />);
    await screen.findByText("Top level");
    const replyButtons = screen.getAllByText("Reply");
    expect(replyButtons.length).toBeGreaterThanOrEqual(2);
  });

  it("does not show any Reply button when logged out", async () => {
    mockUseAuth.mockReturnValue(noAuth());
    mockGetTickComments.mockResolvedValue([commentA]);
    render(<CommentSection tickId="tick-1" />);
    await screen.findByText("Top level");
    expect(screen.queryByText("Reply")).not.toBeInTheDocument();
  });

  it("shows Delete only for the comment the logged-in user owns", async () => {
    // alice owns c-1, bob owns c-2; logged in as alice
    const withReply = { ...commentA, replies: [commentB] };
    mockUseAuth.mockReturnValue(asAlice());
    mockGetTickComments.mockResolvedValue([withReply]);
    render(<CommentSection tickId="tick-1" />);
    await screen.findByText("Top level");
    // Alice sees exactly one Delete button (her own comment, c-1)
    expect(screen.getAllByText("Delete")).toHaveLength(1);
  });

  it("does not show Delete when the user does not own any comments", async () => {
    // Only alice's comment; logged in as bob
    mockUseAuth.mockReturnValue(asBob());
    mockGetTickComments.mockResolvedValue([commentA]);
    render(<CommentSection tickId="tick-1" />);
    await screen.findByText("Top level");
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });
});

// ── Submitting a top-level comment ────────────────────────────────────────────

describe("CommentSection — top-level comment submission", () => {
  it("calls postComment with the correct tickId and body", async () => {
    const newComment = makeComment({ id: "c-new", body: "Hello!" });
    mockUseAuth.mockReturnValue(asAlice());
    mockGetTickComments.mockResolvedValue([]);
    mockPostComment.mockResolvedValue(newComment);

    render(<CommentSection tickId="tick-1" />);
    const input = await screen.findByPlaceholderText(/add a comment/i);

    fireEvent.change(input, { target: { value: "Hello!" } });
    await act(async () => {
      fireEvent.click(screen.getByText("Post"));
    });

    expect(mockPostComment).toHaveBeenCalledWith({ tickId: "tick-1", body: "Hello!" });
  });

  it("appends the new comment to the list after a successful post", async () => {
    const newComment = makeComment({ id: "c-new", body: "Hello!" });
    mockUseAuth.mockReturnValue(asAlice());
    mockGetTickComments.mockResolvedValue([]);
    mockPostComment.mockResolvedValue(newComment);

    render(<CommentSection tickId="tick-1" />);
    const input = await screen.findByPlaceholderText(/add a comment/i);

    fireEvent.change(input, { target: { value: "Hello!" } });
    await act(async () => {
      fireEvent.click(screen.getByText("Post"));
    });

    expect(screen.getByText("Hello!")).toBeInTheDocument();
  });

  it("clears the input after a successful post", async () => {
    const newComment = makeComment({ id: "c-new", body: "Hello!" });
    mockUseAuth.mockReturnValue(asAlice());
    mockGetTickComments.mockResolvedValue([]);
    mockPostComment.mockResolvedValue(newComment);

    render(<CommentSection tickId="tick-1" />);
    const input = await screen.findByPlaceholderText(/add a comment/i);

    fireEvent.change(input, { target: { value: "Hello!" } });
    await act(async () => {
      fireEvent.click(screen.getByText("Post"));
    });

    expect((input as HTMLInputElement).value).toBe("");
  });

  it("disables the Post button when the input is empty", async () => {
    mockUseAuth.mockReturnValue(asAlice());
    render(<CommentSection tickId="tick-1" />);
    await screen.findByPlaceholderText(/add a comment/i);
    expect(screen.getByText("Post")).toBeDisabled();
  });
});

// ── Reply submission ──────────────────────────────────────────────────────────

describe("CommentSection — reply submission", () => {
  it("opens an inline reply form when Reply is clicked", async () => {
    mockUseAuth.mockReturnValue(asAlice());
    mockGetTickComments.mockResolvedValue([commentA]);

    render(<CommentSection tickId="tick-1" />);
    await screen.findByText("Top level");
    fireEvent.click(screen.getByText("Reply"));

    expect(screen.getByPlaceholderText(/reply to @alice/i)).toBeInTheDocument();
  });

  it("calls postComment with parentCommentId when posting a reply", async () => {
    const reply = makeComment({ id: "c-r", body: "My reply", parentCommentId: "c-1" });
    mockUseAuth.mockReturnValue(asAlice());
    mockGetTickComments.mockResolvedValue([commentA]);
    mockPostComment.mockResolvedValue(reply);

    render(<CommentSection tickId="tick-1" />);
    await screen.findByText("Top level");
    fireEvent.click(screen.getByText("Reply"));

    fireEvent.change(screen.getByPlaceholderText(/reply to @alice/i), {
      target: { value: "My reply" },
    });
    // When the reply form is open there are two "Reply" buttons: the toggle and the submit.
    // We want the submit button (last one).
    await act(async () => {
      const replyBtns = screen.getAllByRole("button", { name: /^reply$/i });
      fireEvent.click(replyBtns[replyBtns.length - 1]);
    });

    expect(mockPostComment).toHaveBeenCalledWith({
      tickId: "tick-1",
      body: "My reply",
      parentCommentId: "c-1",
    });
  });

  it("nests the reply under its parent and closes the reply form", async () => {
    const reply = makeComment({ id: "c-r", body: "My reply", parentCommentId: "c-1" });
    mockUseAuth.mockReturnValue(asAlice());
    mockGetTickComments.mockResolvedValue([commentA]);
    mockPostComment.mockResolvedValue(reply);

    render(<CommentSection tickId="tick-1" />);
    await screen.findByText("Top level");
    fireEvent.click(screen.getByText("Reply"));

    fireEvent.change(screen.getByPlaceholderText(/reply to @alice/i), {
      target: { value: "My reply" },
    });
    await act(async () => {
      const replyBtns = screen.getAllByRole("button", { name: /^reply$/i });
      fireEvent.click(replyBtns[replyBtns.length - 1]);
    });

    expect(screen.getByText("My reply")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/reply to @alice/i)).not.toBeInTheDocument();
  });
});

// ── Delete comment ────────────────────────────────────────────────────────────

describe("CommentSection — deleting comments", () => {
  it("calls deleteComment with the correct id", async () => {
    mockUseAuth.mockReturnValue(asAlice());
    mockGetTickComments.mockResolvedValue([commentA]);
    mockDeleteComment.mockResolvedValue(undefined);

    render(<CommentSection tickId="tick-1" />);
    await screen.findByText("Top level");

    await act(async () => {
      fireEvent.click(screen.getByText("Delete"));
    });

    expect(mockDeleteComment).toHaveBeenCalledWith("c-1");
  });

  it("removes the deleted comment from the rendered list", async () => {
    mockUseAuth.mockReturnValue(asAlice());
    mockGetTickComments.mockResolvedValue([commentA]);
    mockDeleteComment.mockResolvedValue(undefined);

    render(<CommentSection tickId="tick-1" />);
    await screen.findByText("Top level");

    await act(async () => {
      fireEvent.click(screen.getByText("Delete"));
    });

    expect(screen.queryByText("Top level")).not.toBeInTheDocument();
  });

  it("removes a deleted nested reply without affecting its parent", async () => {
    // alice owns both c-1 (top-level) and c-3 (deep reply); bob owns c-2
    const aliceDeepReply = makeComment({ id: "c-3", body: "Deep reply" });
    const tree = { ...commentA, replies: [{ ...commentB, replies: [aliceDeepReply] }] };
    mockUseAuth.mockReturnValue(asAlice());
    mockGetTickComments.mockResolvedValue([tree]);
    mockDeleteComment.mockResolvedValue(undefined);

    render(<CommentSection tickId="tick-1" />);
    await screen.findByText("Top level");
    await screen.findByText("Deep reply");

    // Alice has two Delete buttons: c-1 (Top level) and c-3 (Deep reply)
    const deleteButtons = screen.getAllByText("Delete");
    await act(async () => {
      fireEvent.click(deleteButtons[1]); // second = Deep reply
    });

    expect(screen.queryByText("Deep reply")).not.toBeInTheDocument();
    expect(screen.getByText("Top level")).toBeInTheDocument();
    expect(screen.getByText("Reply to A")).toBeInTheDocument();
  });
});

// ── Highlight ─────────────────────────────────────────────────────────────────

describe("CommentSection — comment highlighting", () => {
  it("applies highlight styles when highlightCommentId matches a comment", async () => {
    mockUseAuth.mockReturnValue(noAuth());
    mockGetTickComments.mockResolvedValue([commentA]);

    render(<CommentSection tickId="tick-1" highlightCommentId="c-1" />);
    await screen.findByText("Top level");

    const node = document.getElementById("comment-c-1");
    expect(node).not.toBeNull();
    expect(node!.className).toContain("bg-orange-500/10");
  });

  it("does not apply highlight styles to a non-targeted comment", async () => {
    mockUseAuth.mockReturnValue(noAuth());
    mockGetTickComments.mockResolvedValue([commentA]);

    render(<CommentSection tickId="tick-1" highlightCommentId="other-id" />);
    await screen.findByText("Top level");

    const node = document.getElementById("comment-c-1");
    expect(node).not.toBeNull();
    expect(node!.className).not.toContain("bg-orange-500/10");
  });
});
