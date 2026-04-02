/**
 * User profile endpoint — fetch or update a single user by handle.
 *
 * @module api/users/handle
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/server/db";
import { resolveUserId } from "@/lib/server/resolveUserId";
import { toUser } from "../route";

/**
 * Fetch a user's public profile by handle.
 *
 * **Authentication:** Optional. When the requester is authenticated as the
 * same user (via session cookie or `?token=`), the response also includes
 * `apiToken` — the caller's personal API token.
 *
 * @param req - Incoming request (session cookie or `?token=` used for identity).
 * @param params - Route params. `handle` is the user's unique handle.
 *
 * @returns The user profile object. When the viewer is the profile owner,
 *   the response additionally includes:
 *   - `apiToken` — UUID v4 token for authenticating API requests.
 *
 * @example
 * ```bash
 * # Public profile
 * curl https://allaboard.dev/api/users/alex
 *
 * # Own profile with API token
 * curl "https://allaboard.dev/api/users/alex?token=<your-api-token>"
 * ```
 *
 * @returns `404` if the handle does not exist.
 * @returns `500` on database error.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    const { handle } = await params;
    const row = await db("users").where({ handle }).first();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Include the API token only when the requester is viewing their own profile
    const viewerId = await resolveUserId(req);
    const user = toUser(row);
    if (viewerId === row.id) {
      return NextResponse.json({ ...user, apiToken: row.api_token });
    }
    return NextResponse.json(user);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch user" }, { status: 500 });
  }
}

/**
 * Update the authenticated user's own profile.
 *
 * **Authentication:** Required — session cookie or `?token=`. Only the
 * profile owner may edit their own profile (`403` otherwise).
 *
 * @param req - Incoming request. JSON body may include any subset of:
 *   - `displayName` — display name string
 *   - `bio` — profile bio text
 *   - `homeBoard` — home board name (e.g. `"Kilter Board (Original)"`)
 *   - `homeBoardAngle` — integer angle (degrees)
 *   - `personalBests` — object with optional `Kilter` and/or `Moonboard` grade strings
 * @param params - Route params. `handle` must match the authenticated user.
 *
 * @returns Updated user profile including `apiToken`.
 *
 * @returns `400` if no updateable fields are provided.
 * @returns `401` if not authenticated.
 * @returns `403` if authenticated as a different user.
 * @returns `500` on database error.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ handle: string }> },
) {
  try {
    const userId = await resolveUserId(req);
    if (!userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

    const { handle } = await params;
    if (userId !== handle) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { displayName, bio, homeBoard, homeBoardAngle, personalBests } =
      await req.json() as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    if (displayName !== undefined) patch.display_name = displayName;
    if (bio !== undefined) patch.bio = bio;
    if (homeBoard !== undefined) patch.home_board = homeBoard;
    if (homeBoardAngle !== undefined) patch.home_board_angle = homeBoardAngle;
    if (personalBests && typeof personalBests === "object") {
      const pb = personalBests as Record<string, string>;
      if (pb.Kilter !== undefined) patch.personal_best_kilter = pb.Kilter;
      if (pb.Moonboard !== undefined) patch.personal_best_moonboard = pb.Moonboard;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    await db("users").where({ handle }).update(patch);
    const row = await db("users").where({ handle }).first();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ...toUser(row), apiToken: row.api_token });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}
