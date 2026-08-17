/**
 * Mounting the banner under React's development double-invoke.
 *
 * `next dev` runs with `reactStrictMode`, which mounts a component, unmounts it,
 * and mounts it again. Anything the component remembers in a ref survives that,
 * so a "have we been torn down?" flag that only ever flips to `true` leaves the
 * second mount permanently cancelled — and the banner renders nothing at all,
 * in development only. That is the regression these tests exist to catch.
 */

import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import SessionHeaderImage from "@/components/SessionHeaderImage";
import type { SessionImage } from "@/lib/types";

jest.mock("@/lib/db", () => ({
  getSessionImage: jest.fn(),
  generateSessionImage: jest.fn(),
  regenerateSessionImage: jest.fn(),
}));

import { getSessionImage, generateSessionImage } from "@/lib/db";

const mockGet = jest.mocked(getSessionImage);
const mockGenerate = jest.mocked(generateSessionImage);

const SESSION_ID = "bencoe-2026-07-23-1";
const RAW = `/api/tick-sessions/${SESSION_ID}/image/raw`;

const ready: SessionImage = { sessionId: SESSION_ID, status: "ready", url: `${RAW}?v=1` };
const none: SessionImage = { sessionId: SESSION_ID, status: "none" } as SessionImage;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("mounting under StrictMode", () => {
  it("still shows a finished banner", async () => {
    mockGet.mockResolvedValue(ready);

    const { container } = render(
      <StrictMode>
        <SessionHeaderImage sessionId={SESSION_ID} isOwner isLoggedIn />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(container.querySelector("img")).toHaveAttribute("src", `${RAW}?v=1`),
    );
  });

  it("still shows the placeholder for a session with no banner yet", async () => {
    mockGet.mockResolvedValue(none);
    mockGenerate.mockResolvedValue({ sessionId: SESSION_ID, status: "pending" } as SessionImage);

    render(
      <StrictMode>
        <SessionHeaderImage sessionId={SESSION_ID} isOwner isLoggedIn />
      </StrictMode>,
    );

    expect(await screen.findByText(/picturing your session/i)).toBeInTheDocument();
  });

  it("asks for a banner exactly once across the double mount", async () => {
    // The other half of the same problem: the flag that stops a second request
    // must not be so sticky that the remount stops waiting for the first one.
    mockGet.mockResolvedValue(none);
    mockGenerate.mockResolvedValue({ sessionId: SESSION_ID, status: "pending" } as SessionImage);

    render(
      <StrictMode>
        <SessionHeaderImage sessionId={SESSION_ID} isOwner isLoggedIn />
      </StrictMode>,
    );

    await waitFor(() => expect(mockGenerate).toHaveBeenCalled());
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("picks up the image a request from an earlier mount produced", async () => {
    // The remount skips asking (already asked) but must still poll, or the page
    // sits on the placeholder forever with the job finishing behind it.
    mockGet.mockResolvedValueOnce(none).mockResolvedValue(ready);
    mockGenerate.mockResolvedValue({ sessionId: SESSION_ID, status: "pending" } as SessionImage);

    const { container } = render(
      <StrictMode>
        <SessionHeaderImage sessionId={SESSION_ID} isOwner isLoggedIn />
      </StrictMode>,
    );

    await waitFor(
      () => expect(container.querySelector("img")).toHaveAttribute("src", `${RAW}?v=1`),
      { timeout: 10_000 },
    );
  }, 15_000);
});
