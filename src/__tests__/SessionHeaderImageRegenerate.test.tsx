/**
 * The regenerate control on a session banner.
 *
 * Regenerating spends real inference and overwrites a picture the climber may
 * be perfectly happy with, so what is pinned here is who is offered it, that
 * one press is one generation, and that the banner already on screen survives
 * until a replacement actually arrives.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SessionHeaderImage from "@/components/SessionHeaderImage";
import type { SessionImage } from "@/lib/types";

jest.mock("@/lib/db", () => ({
  getSessionImage: jest.fn(),
  generateSessionImage: jest.fn(),
  regenerateSessionImage: jest.fn(),
}));

import { getSessionImage, generateSessionImage, regenerateSessionImage } from "@/lib/db";

const mockGet = jest.mocked(getSessionImage);
const mockGenerate = jest.mocked(generateSessionImage);
const mockRegenerate = jest.mocked(regenerateSessionImage);

const SESSION_ID = "alice-2026-10-05-1";
const RAW = `/api/tick-sessions/${SESSION_ID}/image/raw`;

const ready = (v: number): SessionImage =>
  ({ sessionId: SESSION_ID, status: "ready", url: `${RAW}?v=${v}` });

const BUTTON = { name: /generate a new image/i };

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue(ready(1));
  // The automatic path enqueues a job and gets `pending` back; tests that care
  // about what the job produced override `mockGet`.
  mockGenerate.mockResolvedValue({ sessionId: SESSION_ID, status: "pending" } as SessionImage);
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

// ── Waiting out a replacement ─────────────────────────────────────────────────
//
// Regenerating is the one case where a banner already exists while a job runs.
// Nothing writes a `pending` row, so the status stays `ready` — pointing at the
// picture being replaced — for the whole ~35s. Polling has to tell the old row
// from the new one, and the loading state has to end when the new bytes land.

describe("waiting out a replacement", () => {
  beforeEach(() => jest.useFakeTimers({ advanceTimers: true }));
  afterEach(() => jest.useRealTimers());

  const tick = () => act(async () => { await jest.advanceTimersByTimeAsync(4000) });
  const img = (c: HTMLElement) => c.querySelector("img");

  /** Renders with a finished banner and presses regenerate. */
  async function pressRegenerate() {
    mockGet.mockResolvedValue(ready(1));
    mockGenerate.mockResolvedValue({ sessionId: SESSION_ID, status: "pending" } as SessionImage);
    mockRegenerate.mockResolvedValue({ sessionId: SESSION_ID, status: "pending" } as SessionImage);

    const view = render(<SessionHeaderImage sessionId={SESSION_ID} isOwner isLoggedIn />);
    await act(async () => { await jest.advanceTimersByTimeAsync(0) });

    fireEvent.click(await screen.findByRole("button", BUTTON));
    await act(async () => { await jest.advanceTimersByTimeAsync(0) });
    return view;
  }

  it("does not settle on the picture it is replacing", async () => {
    const { container } = await pressRegenerate();

    // The job is still running; the row still describes the old banner.
    await tick();
    expect(img(container)).toHaveAttribute("src", `${RAW}?v=1`);

    // Now it lands.
    mockGet.mockResolvedValue(ready(2));
    await tick();
    expect(img(container)).toHaveAttribute("src", `${RAW}?v=2`);
  });

  it("stops showing the loading state once the replacement has decoded", async () => {
    // The bug this guards: `loaded` was reset on every settle, so a settle that
    // did not change the url left the placeholder up over a good image forever,
    // because the <img> never remounted and never fired `load` again.
    const { container } = await pressRegenerate();

    mockGet.mockResolvedValue(ready(2));
    await tick();

    fireEvent.load(img(container)!);
    expect(screen.queryByText(/picturing your session/i)).not.toBeInTheDocument();
    expect(img(container)).toHaveClass("opacity-100");
  });

  it("keeps the banner visible when a settle does not change the picture", async () => {
    // A settle on the same url must not blank the banner behind a placeholder:
    // the element never remounts, so nothing would ever clear it again.
    mockGet.mockResolvedValue(ready(1));
    mockGenerate.mockResolvedValue({ sessionId: SESSION_ID, status: "pending" } as SessionImage);

    const { container } = render(<SessionHeaderImage sessionId={SESSION_ID} isOwner isLoggedIn />);
    await act(async () => { await jest.advanceTimersByTimeAsync(0) });

    fireEvent.load(img(container)!);
    expect(screen.queryByText(/picturing your session/i)).not.toBeInTheDocument();

    // An unchanged status arriving later leaves the loaded image alone.
    mockRegenerate.mockResolvedValue(ready(1));
    fireEvent.click(await screen.findByRole("button", BUTTON));
    await act(async () => { await jest.advanceTimersByTimeAsync(0) });

    expect(screen.queryByText(/picturing your session/i)).not.toBeInTheDocument();
    expect(img(container)).toHaveClass("opacity-100");
  });
});

// ── A banner that never arrives ───────────────────────────────────────────────
//
// The state that prompted all this: a session showing "generating" with nothing
// behind it. Nothing writes that state any more, but a request can still die
// mid-flight, so the page has to be able to give up and offer another go rather
// than animating forever.

const STALLED_BUTTON = { name: /try generating this image again/i };

describe("a banner that never arrives", () => {
  beforeEach(() => jest.useFakeTimers({ advanceTimers: true }));
  afterEach(() => jest.useRealTimers());

  /** Polls `pending` until the component gives up. */
  async function pollUntilStalled(props: { isOwner: boolean; isLoggedIn?: boolean }) {
    const stuck = { sessionId: SESSION_ID, status: "pending" } as SessionImage;
    mockGet.mockResolvedValue(stuck);
    // The client POSTs once to try recovering it. Here that comes back pending
    // too — the case where whatever holds the session never produces anything.
    mockGenerate.mockResolvedValue(stuck);

    const view = render(<SessionHeaderImage sessionId={SESSION_ID} {...props} />);
    // Let the status fetch and the one recovery POST settle before polling.
    await act(async () => { await jest.advanceTimersByTimeAsync(0); });

    // 30 polls at 4s apart. Faster than waiting out two real minutes.
    for (let i = 0; i < 32; i++) {
      await act(async () => { await jest.advanceTimersByTimeAsync(4000); });
    }
    return view;
  }

  it("stops pretending an image is on its way", async () => {
    await pollUntilStalled({ isOwner: true, isLoggedIn: true });

    expect(await screen.findByText(/no image yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/picturing your session/i)).not.toBeInTheDocument();
  });

  it("offers a signed-in viewer another attempt", async () => {
    await pollUntilStalled({ isOwner: false, isLoggedIn: true });

    expect(await screen.findByRole("button", STALLED_BUTTON)).toBeInTheDocument();
  });

  it("recovers the banner when that attempt is pressed", async () => {
    const { container } = await pollUntilStalled({ isOwner: true, isLoggedIn: true });

    mockRegenerate.mockResolvedValue(ready(9));
    fireEvent.click(await screen.findByRole("button", STALLED_BUTTON));

    await waitFor(() =>
      expect(container.querySelector("img")).toHaveAttribute("src", `${RAW}?v=9`),
    );
  });

  it("shows a signed-out viewer nothing at all rather than an empty frame", async () => {
    const { container } = await pollUntilStalled({ isOwner: false });

    expect(container).toBeEmptyDOMElement();
  });
});
