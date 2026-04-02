/**
 * Health check endpoint.
 *
 * @module api/health
 * @packageDocumentation
 */

import { NextResponse } from "next/server";

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
  return NextResponse.json({ ok: true });
}
