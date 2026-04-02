/**
 * Beta videos for a climb — add and remove Instagram video links.
 *
 * @module api/climbs/id/beta-videos
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
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

  try {
    const { id } = await params;
    const climb = await db("climbs").where({ id }).first();
    if (!climb) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (climb.author !== session.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { url } = await req.json() as { url: string };
    if (!url?.trim()) return NextResponse.json({ error: "url is required" }, { status: 400 });

    // Fetch thumbnail from instagram oEmbed
    let thumbnail: string | null = null;
    try {
      const oembedUrl = `https://api.instagram.com/oembed?url=${encodeURIComponent(url)}&maxwidth=200`;
      const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json() as { thumbnail_url?: string };
        thumbnail = data.thumbnail_url ?? null;
      }
    } catch { /* leave thumbnail null */ }

    const [maxOrder] = await db("beta_videos")
      .where({ climb_id: id })
      .max("sort_order as max");
    const sort_order = (Number(maxOrder?.max ?? -1)) + 1;

    const [row] = await db("beta_videos")
      .insert({ climb_id: id, url: url.trim(), thumbnail, sort_order })
      .returning("*");

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

  try {
    const { id } = await params;
    const climb = await db("climbs").where({ id }).first();
    if (!climb) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (climb.author !== session.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { url } = await req.json() as { url: string };
    await db("beta_videos").where({ climb_id: id, url }).delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete video" }, { status: 500 });
  }
}
