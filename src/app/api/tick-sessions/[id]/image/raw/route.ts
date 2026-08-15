/**
 * Session header image bytes.
 *
 * Split from the status route so the URL can be used directly as an `<img>`
 * src and cached hard: a session's banner is generated once and never
 * regenerated, so the response is immutable.
 *
 * @module api/tick-sessions/id/image/raw
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/server/db";

/**
 * Serve the generated header image for a session.
 *
 * **Authentication:** Not required — sessions are public (shareable
 * permalink), so their banners are public too.
 *
 * @param _req - Incoming request (unused).
 * @param params - Route params. `id` is the session slug
 *   (`<handle>-YYYY-MM-DD-<n>`).
 *
 * @returns The raw image bytes, with an immutable one-year cache header.
 *
 * @returns `404` if no image has been generated for this session.
 * @returns `500` on database error.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const row = await db("session_images")
      .where({ session_id: id, status: "ready" })
      .select("data", "mime_type")
      .first();

    if (!row?.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Buffer is a Uint8Array; Response accepts it directly as a body.
    return new NextResponse(new Uint8Array(row.data), {
      headers: {
        "Content-Type":   row.mime_type ?? "image/jpeg",
        "Content-Length": String(row.data.length),
        "Cache-Control":  "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load image" }, { status: 500 });
  }
}
