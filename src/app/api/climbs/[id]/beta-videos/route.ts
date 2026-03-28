import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import db from "@/lib/server/db";
import { sessionOptions, type SessionData } from "@/lib/server/session";

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
