/**
 * Beta videos for a climb — add and remove Instagram video links.
 *
 * @module api/climbs/id/beta-videos
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import db from "@/lib/server/db";
import { sessionOptions, type SessionData } from "@/lib/server/session";

/**
 * Attach an Instagram video URL to a climb as a beta video.
 *
 * **Authentication:** Required — session cookie. Only the climb's author
 * may add beta videos (`403` otherwise).
 *
 * @param req - Incoming request. JSON body:
 *   - `url` *(required)* — full Instagram post or reel URL.
 * @param params - Route params. `id` is the climb UUID.
 *
 * @remarks
 * The handler attempts to fetch a thumbnail via the Instagram oEmbed API.
 * If the fetch fails or times out (4 s), the video is still saved with
 * `thumbnail: null`.
 *
 * @returns `{ "url": "...", "thumbnail": "..." }` with status `201`.
 *
 * @returns `400` if `url` is missing.
 * @returns `401` if not authenticated.
 * @returns `403` if the caller is not the climb author.
 * @returns `404` if the climb does not exist.
 * @returns `500` on database error.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  // Attach identity to the request scope so logs inherit user.id.
  Sentry.getIsolationScope().setUser({ id: session.userId });

  try {
    const { id } = await params;
    const climb = await db("climbs").where({ id }).first();
    if (!climb) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (climb.author !== session.userId) {
      // Permission event: a non-owner attempted to add a beta video.
      Sentry.logger.warn("Forbidden beta video create", {
        action: "create", resource: "beta_video", climbId: id,
        owner: climb.author, outcome: "forbidden",
      });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { url } = await req.json() as { url: string };
    if (!url?.trim()) return NextResponse.json({ error: "url is required" }, { status: 400 });

    // Fetch the thumbnail from Instagram's oEmbed API. This is a flaky upstream,
    // so we retry transient failures (network/timeout and 429/5xx) a few times.
    // Each retry is logged with the attempt count and status code — useful
    // lead-up context if it ultimately fails. Only when we exhaust every attempt
    // do we capture an exception, so a real Instagram outage surfaces in Sentry
    // (with issue grouping/triage) rather than as repeated log noise. The video
    // is saved without a thumbnail either way, so a failure never breaks the request.
    const MAX_ATTEMPTS = 3;
    const oembedUrl = `https://api.instagram.com/oembed?url=${encodeURIComponent(url)}&maxwidth=200`;
    let thumbnail: string | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(4000) });
        if (res.ok) {
          const data = await res.json() as { thumbnail_url?: string };
          thumbnail = data.thumbnail_url ?? null;
          break;
        }
        // A non-transient status (e.g. 404 for a deleted/private post) isn't worth
        // retrying — give up quietly with no thumbnail.
        if (res.status !== 429 && res.status < 500) break;
        if (attempt < MAX_ATTEMPTS) {
          // Lead-up to a possible failure — a log line, not an exception yet.
          Sentry.logger.error("Retrying Instagram oEmbed", {
            attempt, maxAttempts: MAX_ATTEMPTS, statusCode: res.status, climbId: id,
          });
        } else {
          // Exhausted retries: now it's a real error worth capturing.
          Sentry.captureException(new Error("Instagram oEmbed failed after retries"), {
            tags: { upstream: "instagram_oembed" },
            extra: { attempts: MAX_ATTEMPTS, statusCode: res.status, climbId: id },
          });
        }
      } catch (err) {
        // Network error or timeout — also transient.
        if (attempt < MAX_ATTEMPTS) {
          Sentry.logger.warn("Retrying Instagram oEmbed", {
            attempt, maxAttempts: MAX_ATTEMPTS,
            errorName: err instanceof Error ? err.name : "unknown", climbId: id,
          });
        } else {
          Sentry.captureException(err, {
            tags: { upstream: "instagram_oembed" },
            extra: { attempts: MAX_ATTEMPTS, climbId: id },
          });
        }
      }
    }

    const [maxOrder] = await db("beta_videos")
      .where({ climb_id: id })
      .max("sort_order as max");
    const sort_order = (Number(maxOrder?.max ?? -1)) + 1;

    const [row] = await db("beta_videos")
      .insert({ climb_id: id, url: url.trim(), thumbnail, sort_order })
      .returning("*");

    // Audit event: who added a beta video to which climb, and when.
    Sentry.logger.info("Beta video created", {
      action: "create", resource: "beta_video", betaVideoId: row.id,
      climbId: id,
    });

    return NextResponse.json({
      url:       row.url,
      thumbnail: row.thumbnail ?? undefined,
    }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add video" }, { status: 500 });
  }
}

/**
 * Remove a beta video URL from a climb.
 *
 * **Authentication:** Required — session cookie. Only the climb's author
 * may remove beta videos (`403` otherwise).
 *
 * @param req - Incoming request. JSON body:
 *   - `url` *(required)* — the exact URL to remove.
 * @param params - Route params. `id` is the climb UUID.
 *
 * @returns `{ "ok": true }` on success.
 *
 * @returns `401` if not authenticated.
 * @returns `403` if the caller is not the climb author.
 * @returns `404` if the climb does not exist.
 * @returns `500` on database error.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  // Attach identity to the request scope so logs inherit user.id.
  Sentry.getIsolationScope().setUser({ id: session.userId });

  try {
    const { id } = await params;
    const climb = await db("climbs").where({ id }).first();
    if (!climb) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (climb.author !== session.userId) {
      // Permission event: a non-owner attempted to remove a beta video.
      Sentry.logger.warn("Forbidden beta video delete", {
        action: "delete", resource: "beta_video", climbId: id,
        owner: climb.author, outcome: "forbidden",
      });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { url } = await req.json() as { url: string };
    await db("beta_videos").where({ climb_id: id, url }).delete();

    // Audit event: who removed a beta video from which climb, and when.
    Sentry.logger.info("Beta video deleted", {
      action: "delete", resource: "beta_video", climbId: id,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete video" }, { status: 500 });
  }
}
