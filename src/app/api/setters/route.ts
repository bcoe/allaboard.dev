/**
 * Setter name suggestions endpoint.
 *
 * @module api/setters
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/server/db";

/**
 * Return setter names that match a prefix/substring query.
 *
 * **Authentication:** Not required.
 *
 * @param req - Incoming request. Supported query parameters:
 *   - `q` — case-insensitive substring to match against setter names.
 *   - `limit` — max results to return (default 10, max 50).
 *
 * @returns Array of matching setter name strings, ordered alphabetically.
 *
 * @returns `500` on database error.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const q     = searchParams.get("q")?.trim() ?? "";
    const limit = Math.min(Number(searchParams.get("limit") ?? 10), 50);

    const rows = await db("setters")
      .modify((qb) => {
        if (q) qb.whereILike("name", `%${q}%`);
      })
      .orderByRaw("name ILIKE ? DESC, name ASC", [`${q}%`])
      .limit(limit)
      .select("name");

    return NextResponse.json(rows.map((r: { name: string }) => r.name));
  } catch (err) {
    console.error("[setters] GET error:", err);
    return NextResponse.json({ error: "Failed to fetch setters" }, { status: 500 });
  }
}
