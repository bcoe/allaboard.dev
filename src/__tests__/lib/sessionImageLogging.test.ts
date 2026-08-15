/**
 * @jest-environment node
 *
 * What the banner pipeline reports to Sentry.
 *
 * The generated art direction is the interesting half of this feature — it is
 * the only explanation of *why* a banner looks the way it does — so it must
 * reach the logs, on success and on a failed render alike. An earlier version
 * logged only the prompt's length, which is useless for reading back.
 */

jest.mock("ai", () => ({ generateText: jest.fn(), generateImage: jest.fn() }));
jest.mock("@ai-sdk/gateway", () => ({
  gateway: Object.assign(jest.fn(), { imageModel: jest.fn() }),
}));

import * as Sentry from "@sentry/nextjs";
import { generateText, generateImage } from "ai";
import { generateSessionBanner } from "@/lib/server/sessionImage";
import type { UserTick } from "@/lib/types";

const mockGenerateText = jest.mocked(generateText);
const mockGenerateImage = jest.mocked(generateImage);

const PROMPT =
  "Two small capes hang side by side from a single carabiner on a dark rock wall, " +
  "one ember-orange spotlight, vast negative space, fine film grain, no text.";

const image = { uint8Array: new Uint8Array([0xff, 0xd8, 0xff]), mediaType: "image/jpeg" };

const ticks: UserTick[] = [{
  id: "t1", climbId: "c1", climbName: "batman and robin climb", grade: "V3",
  boardName: "Kilter Board (Original)", angle: 40, rating: 4, sent: true,
  date: "2026-07-14T18:00:00.000Z", createdAt: "2026-07-14T18:00:00.000Z",
}];

const session = {
  id: "bencoe-2026-07-14-1", tickCount: 1, sentCount: 1,
  hardestGrade: "V3" as const, totalMinutes: undefined,
};

/** Collects the attributes of one Sentry log call by message. */
function attrsFor(spy: jest.SpyInstance, message: string) {
  const call = spy.mock.calls.find((c) => c[0] === message);
  return call?.[1] as Record<string, unknown> | undefined;
}

let infoSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.AI_GATEWAY_API_KEY = "test-key";
  infoSpy = jest.spyOn(Sentry.logger, "info").mockImplementation(() => {});
  warnSpy = jest.spyOn(Sentry.logger, "warn").mockImplementation(() => {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockGenerateText.mockResolvedValue({ text: PROMPT } as any);
});

afterEach(() => jest.restoreAllMocks());

describe("session banner logging", () => {
  it("logs the generated art direction verbatim on success", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGenerateImage.mockResolvedValue({ images: [image] } as any);

    await generateSessionBanner(session, ticks);

    const attrs = attrsFor(infoSpy, "Session banner generated");
    expect(attrs?.["ai.image_prompt"]).toBe(PROMPT);
  });

  it("logs the prompt alongside the identifying context, not on its own", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGenerateImage.mockResolvedValue({ images: [image] } as any);

    await generateSessionBanner(session, ticks);

    expect(attrsFor(infoSpy, "Session banner generated")).toMatchObject({
      "session.id": "bencoe-2026-07-14-1",
      "ai.image_prompt": PROMPT,
      "ai.prompt_chars": PROMPT.length,
      "ai.image_model": expect.any(String),
      "image.mime_type": "image/jpeg",
    });
  });

  it("logs the prompt on a failed render, where it is needed most", async () => {
    mockGenerateImage
      .mockRejectedValueOnce(new Error("Invalid JSON response"))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValueOnce({ images: [image] } as any);

    await generateSessionBanner(session, ticks);

    expect(attrsFor(warnSpy, "Session banner render failed, retrying")).toMatchObject({
      "ai.image_prompt": PROMPT,
      "ai.attempt": 1,
      "error.message": "Invalid JSON response",
    });
  });

  it("caps a runaway prompt so log volume stays bounded", async () => {
    const huge = "x".repeat(5000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGenerateText.mockResolvedValue({ text: huge } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGenerateImage.mockResolvedValue({ images: [image] } as any);

    await generateSessionBanner(session, ticks);

    const logged = attrsFor(infoSpy, "Session banner generated")?.["ai.image_prompt"] as string;
    expect(logged.length).toBeLessThanOrEqual(1001); // 1000 + ellipsis
    expect(logged.endsWith("…")).toBe(true);
  });

  it("truncates only the log copy — the model still gets the whole prompt", async () => {
    const huge = "y".repeat(5000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGenerateText.mockResolvedValue({ text: huge } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGenerateImage.mockResolvedValue({ images: [image] } as any);

    const banner = await generateSessionBanner(session, ticks);

    expect(mockGenerateImage.mock.calls[0][0].prompt).toBe(huge);
    expect(banner.prompt).toBe(huge);
  });
});
