/**
 * Generates the AI header banner for a climbing session.
 *
 * Two model calls, in order:
 *
 *   1. A language model reads the session's climbs and notes and writes an
 *      art direction brief — one image prompt weaving several specifics of
 *      the session into a single scene. This step exists because raw climb
 *      names and notes make a poor image prompt on their own ("argh", "My god
 *      what a stupid climb"), and because it is where the notes-over-names
 *      weighting and the three-details rule are enforced.
 *   2. An image model renders that prompt as a 1200x400 banner.
 *
 * Both calls go through the Vercel AI Gateway (`AI_GATEWAY_API_KEY`).
 *
 * Server-only — imported by route handlers, never by client code.
 */

import * as Sentry from "@sentry/nextjs";
import { generateText, generateImage } from "ai";
import { gateway } from "@ai-sdk/gateway";
import sharp from "sharp";
import type { TickSessionSummary, UserTick } from "@/lib/types";

/** Writes the image prompt. Cheap, fast, and the only step that sees the notes. */
const PROMPT_MODEL = process.env.AI_PROMPT_MODEL ?? "anthropic/claude-sonnet-5";

/**
 * Renders the banner.
 *
 * The GPT image models do not take arbitrary aspect ratios — they render a
 * fixed set of near-square sizes — so the widest landscape option is rendered
 * and then cropped to the banner's 3:1 by `cropToBanner`. That costs the top
 * and bottom quarters of the frame, which is why the art direction tells the
 * prompt model to keep the subject in the central band.
 */
const IMAGE_MODEL = process.env.AI_IMAGE_MODEL ?? "openai/gpt-image-2";

/**
 * What the model is asked for, before cropping: the widest landscape size the
 * GPT image models support (3:2). Overridable because it is model-specific —
 * a model that renders 3:1 natively wants `1200x400` here, which makes the
 * crop a no-op re-encode rather than a cut.
 */
const RENDER_SIZE = (process.env.AI_IMAGE_RENDER_SIZE ?? "1536x1024") as `${number}x${number}`;

/** The banner's finished dimensions, after cropping. */
export const BANNER_WIDTH = 1200;
export const BANNER_HEIGHT = 400;
export const BANNER_SIZE = "1200x400" as const;

/**
 * JPEG quality for the cropped banner. 86 keeps a 1200x400 render around
 * 150–250 KB — small enough to sit in a `bytea` column comfortably, and past
 * the point where more quality is visible behind a page title.
 */
const BANNER_JPEG_QUALITY = 86;

/** Notes longer than this are truncated — a banner needs the gist, not an essay. */
const MAX_NOTE_CHARS = 400;

/**
 * Ceiling on the prompt text sent to logs.
 *
 * Logging model output is normally something to avoid on cost and PII
 * grounds, but this particular string is worth reading: it is the art
 * direction, it is what makes a banner explicable after the fact, and the
 * brief caps it at ~90 words. The limit is generous enough that a
 * well-behaved prompt is never truncated, and exists only so a model that
 * ignores the word count can't quietly inflate log volume.
 */
const MAX_LOGGED_PROMPT_CHARS = 1000;

/** Bounds the prompt for logging without touching what is sent to the model. */
function forLog(prompt: string): string {
  return prompt.length <= MAX_LOGGED_PROMPT_CHARS
    ? prompt
    : `${prompt.slice(0, MAX_LOGGED_PROMPT_CHARS)}…`;
}

/**
 * The art direction brief.
 *
 * The constraints that matter most are encoded here rather than in the image
 * prompt, so they cannot be diluted by whatever the notes say: the notes
 * outrank the climb names, the banner must be recognisably *this* session
 * rather than generic climbing art, and nothing in the image may contain text.
 */
const ART_DIRECTION = `You are the art director for allaboard, a bouldering logbook. You write image-generation prompts for the header banner that sits at the top of a single climbing session.

You will be given the climbs a climber logged in one session and, more importantly, the notes they wrote about each climb. Turn that session into one image prompt.

Rules:
- Build the scene from at least THREE specific details of this session — an image or mood from a note, a motif suggested by a climb name, a grade fought for, an attempt count, the hours spent. More is better. They must resolve into ONE coherent moment, sharing a setting and a light source, never a collage of unrelated parts. The climber should recognise their own session in it.
- The NOTES are the primary source. They carry the mood: the struggle, the triumph, the tedium, the absurdity. Climb names are secondary flavour — a name may suggest an object or motif, but never let a name override what the notes say. If the notes and the names disagree, follow the notes.
- Setting: a real bouldering gym, plainly legible as one. Chalked plastic holds and volumes of distinct shapes bolted across an overhanging wall, crash mats, tape, brushes, high dim rafters. The holds must read unmistakably as holds.
- Style: anime. Crisp cel-shaded linework and cinematic staging in the register of Ghost in the Shell, but a shade lighter and warmer than that — detailed and grounded, never chibi, never soft pastel fantasy.
- The result is a 3:1 ultrawide banner sitting behind a page title: calm and uncluttered, generous negative space, the subject off to one side, nothing busy or high-contrast through the middle.
- It is rendered in a wider-than-tall frame and then cropped to that 3:1 band from the centre, so the top and bottom quarters are cut away. Keep every essential element inside the central horizontal band, and ask for a composition that is deliberately empty above and below it.
- Palette: deep charcoal and warm stone browns with a single ember-orange accent light. Moody and cinematic, but not murky.
- ABSOLUTELY NO text, letters, numbers, words, signage, logos, labels, or writing of any kind anywhere in the image. Never ask for any.
- Aim for one quiet visual joke: deadpan, surreal, faintly absurd — the kind that earns a snort, not a laugh track. If the notes are euphoric, go gently mythic. If they read as suffering, go gently ridiculous. Never a meme, never slapstick, never a caricature.

Reply with ONLY the image prompt, one paragraph, under 120 words. No preamble, no quotation marks.`;

/**
 * Renders the session as the plain text handed to the prompt model.
 *
 * Climbs are listed in the order they were logged. Notes are labelled
 * explicitly so the model can tell them apart from the names.
 */
export function buildSessionBrief(
  session: Pick<TickSessionSummary, "tickCount" | "sentCount" | "hardestGrade" | "totalMinutes">,
  ticks: UserTick[],
): string {
  const lines: string[] = [];

  const parts = [`${session.tickCount} climbs logged`, `${session.sentCount} sent`];
  if (session.hardestGrade) parts.push(`hardest send ${session.hardestGrade}`);
  if (session.totalMinutes != null) parts.push(`${session.totalMinutes} minutes on the wall`);
  lines.push(`Session: ${parts.join(", ")}.`, "");

  ticks.forEach((tick, i) => {
    const meta = [tick.grade, tick.sent ? "sent" : "not sent (still working it)"];
    if (tick.attempts != null) meta.push(`${tick.attempts} attempts`);
    lines.push(`${i + 1}. Climb name: "${tick.climbName}" (${meta.join(", ")})`);

    const note = tick.comment?.trim();
    lines.push(note ? `   Climber's note: "${truncate(note)}"` : `   Climber's note: (none)`);
  });

  return lines.join("\n");
}

function truncate(s: string): string {
  return s.length <= MAX_NOTE_CHARS ? s : `${s.slice(0, MAX_NOTE_CHARS).trimEnd()}…`;
}

/**
 * Renders the prompt, retrying once on a transient failure.
 *
 * The AI SDK retries its own retryable errors (429s, 5xx, dropped
 * connections), but treats a malformed response body as terminal — and that
 * is exactly the failure seen in practice ("Invalid JSON response" after a
 * full ~22s render). One extra attempt costs a request we were going to lose
 * anyway and keeps the worst case (~50s) inside the route's 60s budget, which
 * is why this does not retry further; a session that fails twice in a row is
 * picked up by the cross-visit retry instead.
 */
async function renderWithRetry(prompt: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await generateImage({
        model: gateway.imageModel(IMAGE_MODEL),
        prompt,
        size: RENDER_SIZE,
      });

      const image = result.images[0];
      if (!image) throw new Error(`${IMAGE_MODEL} returned no image`);
      return image;
    } catch (err) {
      if (attempt >= 2) throw err;
      // Error context for a failure that has not thrown yet — the retry may
      // well succeed, in which case nothing else records that this happened.
      Sentry.logger.warn("Session banner render failed, retrying", {
        "ai.image_model": IMAGE_MODEL,
        "ai.attempt": attempt,
        // The prompt is the first thing worth seeing on a rejected render —
        // a content refusal is only legible next to what was asked for.
        "ai.image_prompt": forLog(prompt),
        "error.message": describeError(err),
      });
    }
  }
}

/**
 * Crops and re-encodes a render to exactly 1200x400.
 *
 * `cover` scales the render until it fills the banner, then takes the centre —
 * from a 3:2 source that keeps the full width and the middle half of the
 * height. The art direction is written to survive that cut.
 *
 * This never fails the pipeline. By the time it runs an image has already been
 * paid for and generated, and an uncropped one still displays correctly: the
 * page renders the banner in an `aspect-[3/1]` box with `object-cover`, so the
 * browser makes the same centre cut. What is lost by falling back is stored
 * bytes and a guaranteed-uniform asset, neither of which is worth discarding a
 * finished image over — so a failure here is a warning, not a throw.
 */
async function cropToBanner(
  bytes: Uint8Array,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  try {
    const out = await sharp(bytes)
      .resize(BANNER_WIDTH, BANNER_HEIGHT, { fit: "cover", position: "centre" })
      .jpeg({ quality: BANNER_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    return { bytes: out, mimeType: "image/jpeg" };
  } catch (err) {
    Sentry.logger.warn("Session banner crop failed, storing the render as-is", {
      "ai.image_model": IMAGE_MODEL,
      "image.render_size": RENDER_SIZE,
      "image.bytes": bytes.length,
      "error.message": describeError(err),
    });
    return null;
  }
}

/**
 * Flattens a model error into one searchable line.
 *
 * AI SDK errors put the useful part (HTTP status, upstream body) on the error
 * object rather than in `message` — bare `err.message` yields uninformative
 * strings like "Invalid JSON response", which is not enough to tell a content
 * rejection from an outage when reading the row back later.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err).slice(0, 500);

  const e = err as Error & { statusCode?: number; responseBody?: string; cause?: unknown };
  const parts = [e.name && e.name !== "Error" ? `${e.name}: ${e.message}` : e.message];
  if (e.statusCode) parts.push(`status=${e.statusCode}`);
  if (e.responseBody) parts.push(`body=${String(e.responseBody).slice(0, 200)}`);

  const cause = e.cause as { message?: string; statusCode?: number } | undefined;
  if (cause?.message) parts.push(`cause=${cause.message}`);
  if (cause?.statusCode) parts.push(`cause_status=${cause.statusCode}`);

  return parts.join(" | ").slice(0, 500);
}

export interface GeneratedBanner {
  prompt: string;
  model: string;
  mimeType: string;
  bytes: Buffer;
}

/**
 * Runs the two-step pipeline and returns the finished banner.
 *
 * Throws if the gateway key is missing or either model call fails — the caller
 * is responsible for recording the failure against the session.
 */
export async function generateSessionBanner(
  session: Pick<TickSessionSummary, "id" | "tickCount" | "sentCount" | "hardestGrade" | "totalMinutes">,
  ticks: UserTick[],
): Promise<GeneratedBanner> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error("AI_GATEWAY_API_KEY is not set");
  }

  return Sentry.startSpan(
    {
      name: "session-image.generate",
      op: "ai.pipeline",
      attributes: { "session.id": session.id, "ai.image_model": IMAGE_MODEL },
    },
    async () => {
      const { text } = await generateText({
        model: gateway(PROMPT_MODEL),
        system: ART_DIRECTION,
        prompt: buildSessionBrief(session, ticks),
        experimental_telemetry: { isEnabled: true, functionId: "session-image.prompt" },
      });

      const prompt = text.trim();
      if (!prompt) throw new Error(`${PROMPT_MODEL} returned an empty image prompt`);

      const image = await renderWithRetry(prompt);
      const cropped = await cropToBanner(image.uint8Array);

      const bytes = cropped?.bytes ?? Buffer.from(image.uint8Array);
      const mimeType = cropped?.mimeType ?? image.mediaType ?? "image/jpeg";

      Sentry.logger.info("Session banner generated", {
        "session.id": session.id,
        "ai.prompt_model": PROMPT_MODEL,
        "ai.image_model": IMAGE_MODEL,
        // The generated art direction — the interesting half of this feature,
        // and the only record of *why* a banner looks the way it does that is
        // searchable across sessions (the row keeps a copy, but one at a time).
        "ai.image_prompt": forLog(prompt),
        "ai.prompt_chars": prompt.length,
        "image.mime_type": mimeType,
        // Both sizes: the render is what was paid for, the stored bytes are
        // what the page serves, and the ratio between them is the crop.
        "image.render_size": RENDER_SIZE,
        "image.render_bytes": image.uint8Array.length,
        "image.bytes": bytes.length,
        "image.cropped": cropped !== null,
        tick_count: ticks.length,
      });

      return { prompt, model: IMAGE_MODEL, mimeType, bytes };
    },
  );
}
