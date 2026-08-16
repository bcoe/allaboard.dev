/**
 * The regenerate control on a session banner.
 *
 * Regenerating spends real inference and overwrites a picture the climber may
 * be perfectly happy with, so what is pinned here is who is offered it, that
 * one press is one generation, and that the banner already on screen survives
 * until a replacement actually arrives.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SessionHeaderImage from "@/components/SessionHeaderImage";
import type { SessionImage } from "@/lib/types";

jest.mock("@/lib/db", () => ({
  getSessionImage: jest.fn(),
  generateSessionImage: jest.fn(),
  regenerateSessionImage: jest.fn(),
}));

import { getSessionImage, regenerateSessionImage } from "@/lib/db";

const mockGet = jest.mocked(getSessionImage);
const mockRegenerate = jest.mocked(regenerateSessionImage);

const SESSION_ID = "alice-2026-10-05-1";
const RAW = `/api/tick-sessions/${SESSION_ID}/image/raw`;

const ready = (v: number): SessionImage =>
  ({ sessionId: SESSION_ID, status: "ready", url: `${RAW}?v=${v}` });

const BUTTON = { name: /generate a new image/i };

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue(ready(1));
});

describe("regenerating a session banner", () => {
  it("offers the control to a signed-in visitor, not only the owner", async () => {
    render(<SessionHeaderImage sessionId={SESSION_ID} isOwner={false} isLoggedIn />);

    expect(await screen.findByRole("button", BUTTON)).toBeInTheDocument();
  });

  it("hides the control from a signed-out viewer", async () => {
    render(<SessionHeaderImage sessionId={SESSION_ID} isOwner={false} />);

    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.queryByRole("button", BUTTON)).not.toBeInTheDocument();
  });

  it("swaps in the new image once it arrives", async () => {
    mockRegenerate.mockResolvedValue(ready(2));

    const { container } = render(<SessionHeaderImage sessionId={SESSION_ID} isOwner isLoggedIn />);
    await userEvent.click(await screen.findByRole("button", BUTTON));

    expect(mockRegenerate).toHaveBeenCalledWith(SESSION_ID);
    await waitFor(() =>
      expect(container.querySelector("img")).toHaveAttribute("src", `${RAW}?v=2`),
    );
  });

  it("keeps the current banner on screen while the new one is being made", async () => {
    mockRegenerate.mockReturnValue(new Promise(() => {})); // never settles

    const { container } = render(<SessionHeaderImage sessionId={SESSION_ID} isOwner isLoggedIn />);
    await userEvent.click(await screen.findByRole("button", BUTTON));

    // Still the old picture — it is the session's banner until replaced.
    expect(container.querySelector("img")).toHaveAttribute("src", `${RAW}?v=1`);
  });

  it("takes one press for one generation, however many times it is clicked", async () => {
    mockRegenerate.mockReturnValue(new Promise(() => {}));

    render(<SessionHeaderImage sessionId={SESSION_ID} isOwner isLoggedIn />);
    const button = await screen.findByRole("button", BUTTON);

    await userEvent.click(button);
    expect(button).toBeDisabled();

    await userEvent.click(button);
    await userEvent.click(button);
    expect(mockRegenerate).toHaveBeenCalledTimes(1);
  });

  it("leaves the old banner up when regeneration fails", async () => {
    mockRegenerate.mockRejectedValue(new Error("gateway exploded"));

    const { container } = render(<SessionHeaderImage sessionId={SESSION_ID} isOwner isLoggedIn />);
    await userEvent.click(await screen.findByRole("button", BUTTON));

    await waitFor(() => expect(screen.getByRole("button", BUTTON)).not.toBeDisabled());
    expect(container.querySelector("img")).toHaveAttribute("src", `${RAW}?v=1`);
  });

  it("is not offered while there is no banner to replace", async () => {
    mockGet.mockResolvedValue({ sessionId: SESSION_ID, status: "pending" } as SessionImage);

    render(<SessionHeaderImage sessionId={SESSION_ID} isOwner isLoggedIn />);

    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.queryByRole("button", BUTTON)).not.toBeInTheDocument();
  });
});
