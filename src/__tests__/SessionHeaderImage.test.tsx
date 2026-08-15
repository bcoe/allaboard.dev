/**
 * Tests for the session banner and its loading state.
 *
 * The behaviour worth pinning: the placeholder is shown while the image is
 * being made, generation is triggered only by the session's owner and only
 * when no image exists, and a session with no banner renders nothing at all
 * rather than an empty box.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SessionHeaderImage from "@/components/SessionHeaderImage";
import type { SessionImage } from "@/lib/types";

jest.mock("@/lib/db", () => ({
  getSessionImage: jest.fn(),
  generateSessionImage: jest.fn(),
}));

import { getSessionImage, generateSessionImage } from "@/lib/db";

const mockGet = jest.mocked(getSessionImage);
const mockGenerate = jest.mocked(generateSessionImage);

const SESSION_ID = "alice-2026-10-05-1";
const RAW_URL = `/api/tick-sessions/${SESSION_ID}/image/raw`;

const state = (status: SessionImage["status"], url?: string): SessionImage =>
  ({ sessionId: SESSION_ID, status, url });

const PLACEHOLDER = /picturing your session/i;

beforeEach(() => jest.clearAllMocks());

describe("SessionHeaderImage", () => {
  it("shows the placeholder while the owner's image is being generated", async () => {
    mockGet.mockResolvedValue(state("none"));
    // Never settles — holds the component in its loading state.
    mockGenerate.mockReturnValue(new Promise(() => {}));

    const { container } = render(<SessionHeaderImage sessionId={SESSION_ID} isOwner />);

    expect(await screen.findByText(PLACEHOLDER)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("requests generation exactly once for the owner of a session with no image", async () => {
    mockGet.mockResolvedValue(state("none"));
    mockGenerate.mockResolvedValue(state("ready", RAW_URL));

    render(<SessionHeaderImage sessionId={SESSION_ID} isOwner />);

    await waitFor(() => expect(mockGenerate).toHaveBeenCalledTimes(1));
    expect(mockGenerate).toHaveBeenCalledWith(SESSION_ID);
  });

  it("never spends a generation on someone else's session", async () => {
    mockGet.mockResolvedValue(state("none"));

    const { container } = render(<SessionHeaderImage sessionId={SESSION_ID} isOwner={false} />);

    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders an existing image without regenerating it", async () => {
    mockGet.mockResolvedValue(state("ready", RAW_URL));

    const { container } = render(<SessionHeaderImage sessionId={SESSION_ID} isOwner />);

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(container.querySelector("img")).toHaveAttribute("src", RAW_URL);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("keeps the placeholder up until the image has actually decoded", async () => {
    mockGet.mockResolvedValue(state("ready", RAW_URL));

    const { container } = render(<SessionHeaderImage sessionId={SESSION_ID} isOwner />);

    // jsdom never fires load, so the image stays transparent behind the placeholder.
    expect(await screen.findByText(PLACEHOLDER)).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveClass("opacity-0");
  });

  it("shows the placeholder — not a stalled request — when generation is already in flight", async () => {
    mockGet.mockResolvedValue(state("pending"));

    render(<SessionHeaderImage sessionId={SESSION_ID} isOwner />);

    expect(await screen.findByText(PLACEHOLDER)).toBeInTheDocument();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("retries automatically when a failed banner still has attempts left", async () => {
    mockGet.mockResolvedValue({ ...state("failed"), canRetry: true });
    mockGenerate.mockResolvedValue(state("ready", RAW_URL));

    const { container } = render(<SessionHeaderImage sessionId={SESSION_ID} isOwner />);

    await waitFor(() => expect(mockGenerate).toHaveBeenCalledTimes(1));
    expect(mockGenerate).toHaveBeenCalledWith(SESSION_ID);
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
  });

  it("offers the owner a manual retry once the automatic budget is spent", async () => {
    mockGet.mockResolvedValue({ ...state("failed"), canRetry: false });

    render(<SessionHeaderImage sessionId={SESSION_ID} isOwner />);

    expect(await screen.findByText(/couldn't picture this session/i)).toBeInTheDocument();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("forces a fresh budget when the owner clicks Try again", async () => {
    mockGet.mockResolvedValue({ ...state("failed"), canRetry: false });
    mockGenerate.mockResolvedValue(state("ready", RAW_URL));

    const { container } = render(<SessionHeaderImage sessionId={SESSION_ID} isOwner />);

    await userEvent.click(await screen.findByRole("button", { name: /try again/i }));

    expect(mockGenerate).toHaveBeenCalledWith(SESSION_ID, true);
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
  });

  it("shows a visitor nothing at all when generation is exhausted", async () => {
    mockGet.mockResolvedValue({ ...state("failed"), canRetry: false });

    const { container } = render(<SessionHeaderImage sessionId={SESSION_ID} isOwner={false} />);

    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("never retries someone else's failed session", async () => {
    mockGet.mockResolvedValue({ ...state("failed"), canRetry: true });

    render(<SessionHeaderImage sessionId={SESSION_ID} isOwner={false} />);

    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("is decorative — empty alt, so screen readers skip it entirely", async () => {
    mockGet.mockResolvedValue(state("ready", RAW_URL));

    const { container } = render(<SessionHeaderImage sessionId={SESSION_ID} isOwner />);

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    // An empty alt drops the element out of the accessibility tree.
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
