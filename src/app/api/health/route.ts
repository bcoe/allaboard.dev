/**
 * Health check endpoint.
 *
 * @module api/health
 * @packageDocumentation
 */

import { NextResponse } from "next/server";
import db from "@/lib/server/db";

/**
 * Check that the API server is reachable.
 *
 * **Authentication:** Not required.
 *
 * @returns `{ ok: true }` — always returns 200 when the server is up.
 *
 * @example
 * ```bash
 * curl https://allaboard.dev/api/health
 * # { "ok": true }
 * ```
 */
export async function GET() {
  try {
    await db.raw("SELECT 1");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
