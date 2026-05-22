/**
 * Resolves the authenticated user ID for a request.
 *
 * Checks in order:
 *   1. iron-session cookie — set during Google OAuth / onboarding (browser auth)
 *   2. `?token=<UUID v4>` query parameter — API token, validated against users.api_token
 *
 * Returns the user's handle (= users.id) or null if unauthenticated.
 */

import type { NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import * as Sentry from "@sentry/nextjs";
import { sessionOptions, type SessionData } from "./session";
import db from "./db";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolveUserId(req: NextRequest): Promise<string | null> {
  // 1. Iron-session cookie (standard browser auth)
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (session?.userId) {
    Sentry.setUser({ id: session.userId, username: session.userId });
    return session.userId;
  }

  // 2. API token query parameter
  const token = req.nextUrl.searchParams.get("token");
  if (!token || !UUID_V4_RE.test(token)) return null;

  const row = await db("users").where({ api_token: token }).select("id").first();
  if (row?.id) {
    Sentry.setUser({ id: row.id, username: row.id });
    return row.id;
  }
  return null;
}
