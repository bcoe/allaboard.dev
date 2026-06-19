/**
 * Per-user feature flag endpoint — toggle a single feature flag on the
 * authenticated user's own account.
 *
 * @module api/users/handle/feature-flags
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/server/db";
import { resolveUserId } from "@/lib/server/resolveUserId";
import {
  FEATURE_FLAG_DEFAULTS,
  type FeatureFlagKey,
  type FeatureFlags,
} from "@/lib/featureFlags";

function isKnownFlag(key: unknown): key is FeatureFlagKey {
  return typeof key === "string"
    && Object.prototype.hasOwnProperty.call(FEATURE_FLAG_DEFAULTS, key);
}

/**
 * Set a single feature flag on the authenticated user's account.
 *
 * **Authentication:** Required — session cookie or `?token=`. This is a
 * protected resource: a user may only change feature flags on their own
 * account, so `handle` must match the authenticated user (`403` otherwise).
 *
 * @param req - Incoming request. JSON body:
 *   - `flag` *(required)* — the flag key to set (must be a known flag).
 *   - `enabled` *(required)* — boolean; the new value for the flag.
 * @param params - Route params. `handle` must match the authenticated user.
 *
 * @returns `{ "featureFlags": { ... } }` — the user's full flag object after
 *   the update.
 *
 * @returns `400` if `flag` is unknown or `enabled` is not a boolean.
 * @returns `401` if not authenticated.
 * @returns `403` if authenticated as a different user than `handle`.
 * @returns `404` if the user does not exist.
 * @returns `500` on database error.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ handle: string }> },
) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const { handle } = await params;
  if (userId !== handle) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { flag, enabled } = await req.json() as { flag?: unknown; enabled?: unknown };

    if (!isKnownFlag(flag)) {
      return NextResponse.json({ error: "Unknown feature flag" }, { status: 400 });
    }
    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "`enabled` must be a boolean" }, { status: 400 });
    }

    const row = await db("users").where({ id: handle }).first();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Merge into the existing flags so other flags are preserved.
    const current: FeatureFlags = row.feature_flags ?? {};
    const featureFlags: FeatureFlags = { ...current, [flag]: enabled };

    await db("users").where({ id: handle }).update({ feature_flags: featureFlags });

    return NextResponse.json({ featureFlags });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update feature flag" }, { status: 500 });
  }
}
