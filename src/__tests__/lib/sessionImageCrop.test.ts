/**
 * @jest-environment node
 *
 * The banner's shape contract.
 *
 * The GPT image models render a fixed set of near-square sizes, so the
 * pipeline asks for the widest landscape one and crops it down. What matters
 * is that whatever comes back off the wire, the bytes stored against a session
 * are exactly 1200x400 — the page reserves that box before the image loads, so
 * a differently-shaped asset is a layout bug waiting to happen.
 */

jest.mock("ai", () => ({ generateText: jest.fn(), generateImage: jest.fn() }));
jest.mock("@ai-sdk/gateway", () => ({
  gateway: Object.assign(jest.fn(), { imageModel: jest.fn() }),
}));

import sharp from "sharp";
import { generateText, generateImage } from "ai";
import { generateSessionBanner, BANNER_WIDTH, BANNER_HEIGHT } from "@/lib/server/sessionImage";
import type { UserTick } from "@/lib/types";

const mockGenerateText = jest.mocked(generateText);
const mockGenerateImage = jest.mocked(generateImage);

const ticks: UserTick[] = [{
  id: "t1", climbId: "c1", climbName: "Slab Tax", grade: "V4",
  boardName: "Kilter Board (Original)", angle: 40, rating: 3, sent: false,
  comment: "Fell off the last move eleven times.",
  date: "2026-08-15T18:00:00.000Z", createdAt: "2026-08-15T18:00:00.000Z",
}];

const session = {
  id: "bencoe-2026-08-15-1", tickCount: 1, sentCount: 0,
  hardestGrade: undefined, totalMinutes: 90,
};

/** A real image of the given size — sharp needs actual pixels, not a stub. */
async function render(width: number, height: number): Promise<Uint8Array> {
  const png = await sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 30, b: 25 } },
  }).png().toBuffer();
  return new Uint8Array(png);
}

/** Feeds one rendered image through the pipeline and returns the stored bytes. */
async function bannerFrom(image: Uint8Array) {
  mockGenerateImage.mockResolvedValue(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { images: [{ uint8Array: image, mediaType: "image/png" }] } as any,
  );
  return generateSessionBanner(session, ticks);
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.AI_GATEWAY_API_KEY = "test-key";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockGenerateText.mockResolvedValue({ text: "a dim gym wall, ember light" } as any);
});

describe("banner cropping", () => {
  it("crops a 3:2 render down to exactly 1200x400", async () => {
    const banner = await bannerFrom(await render(1536, 1024));

    const meta = await sharp(banner.bytes).metadata();
    expect(meta.width).toBe(BANNER_WIDTH);
    expect(meta.height).toBe(BANNER_HEIGHT);
  });

  it("stores the banner as JPEG regardless of what the model returned", async () => {
    const banner = await bannerFrom(await render(1536, 1024));

    expect(banner.mimeType).toBe("image/jpeg");
    expect((await sharp(banner.bytes).metadata()).format).toBe("jpeg");
  });

  it("normalises a square render too — every banner is the same shape", async () => {
    const banner = await bannerFrom(await render(1024, 1024));

    const meta = await sharp(banner.bytes).metadata();
    expect(meta.width).toBe(BANNER_WIDTH);
    expect(meta.height).toBe(BANNER_HEIGHT);
  });

  it("re-encodes a render that is already 3:1 rather than rejecting it", async () => {
    const banner = await bannerFrom(await render(1200, 400));

    const meta = await sharp(banner.bytes).metadata();
    expect(meta.width).toBe(BANNER_WIDTH);
    expect(meta.height).toBe(BANNER_HEIGHT);
  });

  it("keeps a paid-for image when the crop cannot read it, rather than losing it", async () => {
    // Not a decodable image — sharp throws, and the pipeline must still return
    // the render it already paid for.
    const garbage = new Uint8Array([0xff, 0xd8, 0xff]);
    const banner = await bannerFrom(garbage);

    expect(banner.bytes).toEqual(Buffer.from(garbage));
    expect(banner.mimeType).toBe("image/png"); // whatever the model said
  });

  it("asks the model for the render size, not the finished banner size", async () => {
    await bannerFrom(await render(1536, 1024));

    expect(mockGenerateImage.mock.calls[0][0].size).toBe("1536x1024");
  });
});
