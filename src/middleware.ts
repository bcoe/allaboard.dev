import { NextRequest, NextResponse } from "next/server";
import { setVercelRequestIdFromHeaders } from "@/lib/server/vercel-request-id";
import { setVercelTraceContext } from "@/lib/server/vercel-trace-context";

// ── Rate limit configuration ──────────────────────────────────────────────────
// Change these two values to adjust limits for all API routes.
const RATE_LIMIT_AUTHENTICATED_RPM   = 250; // requests per minute — logged-in users
const RATE_LIMIT_UNAUTHENTICATED_RPM = 25;  // requests per minute — anonymous users
const RATE_LIMIT_WINDOW_MS           = 60_000; // window size (1 minute)

// ── CORS configuration ────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  "https://allaboard.dev",
  "https://www.allaboard.dev",
  "http://localhost:3000",
]);

/**
 * Routes that browsers navigate to directly — no Origin header is sent.
 * These are exempt from the CORS origin check but still rate-limited.
 */
const NAVIGATION_PREFIXES = [
  "/api/auth/google",
  "/api/auth/callback",
  "/api/health",
];

// UUID v4 format — used to detect API token query params for rate-limit bucketing.
// Actual token validity is checked in route handlers via resolveUserId.
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── In-memory rate limit store ────────────────────────────────────────────────
// Works correctly for single-instance deployments and local dev.
// For multi-instance production (e.g. Vercel Edge with many replicas), replace
// with a distributed store such as Upstash Redis.
//
// Anchored to globalThis so the Map survives Next.js hot-module re-evaluation
// in development (without this, the module resets on every request in dev mode).
interface RateLimitEntry { count: number; resetAt: number }
declare global { var __rateLimitStore: Map<string, RateLimitEntry> | undefined }
// eslint-disable-next-line no-var
if (!globalThis.__rateLimitStore) globalThis.__rateLimitStore = new Map();
const store = globalThis.__rateLimitStore;

/**
 * Returns the rate-limit bucket key and limit for this request.
 *
 * Authenticated: keyed by session cookie value (unique per session), higher limit.
 * Unauthenticated: keyed by client IP, lower limit.
 */
function getRateLimitKey(req: NextRequest): { key: string; limit: number } {
  // 1. Session cookie → authenticated bucket
  const session = req.cookies.get("allaboard_session")?.value;
  if (session) {
    return { key: `auth:${session}`, limit: RATE_LIMIT_AUTHENTICATED_RPM };
  }

  // 2. API token query param (UUID v4 format check only — full validation in route handler)
  //    Token holders get the authenticated rate limit; the key is the token itself so each
  //    token has its own bucket independent of IP.
  const token = req.nextUrl.searchParams.get("token");
  if (token && UUID_V4_RE.test(token)) {
    return { key: `token:${token}`, limit: RATE_LIMIT_AUTHENTICATED_RPM };
  }

  // 3. Unauthenticated → IP-based bucket
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  return { key: `unauth:${ip}`, limit: RATE_LIMIT_UNAUTHENTICATED_RPM };
}

/**
 * Increments the counter for `key` and returns whether the request is within
 * the limit, how many requests remain, and when the window resets.
 */
function checkRateLimit(
  key: string,
  limit: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now >= entry.resetAt) {
    const resetAt = now + RATE_LIMIT_WINDOW_MS;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}

function applyRateLimitHeaders(
  res: NextResponse,
  limit: number,
  remaining: number,
  resetAt: number,
): void {
  res.headers.set("X-RateLimit-Limit",     String(limit));
  res.headers.set("X-RateLimit-Remaining", String(remaining));
  res.headers.set("X-RateLimit-Reset",     String(Math.ceil(resetAt / 1000))); // Unix timestamp
}

// ── CORS helpers ──────────────────────────────────────────────────────────────

/**
 * When Origin is absent the request is a same-origin browser fetch, a
 * server-side fetch, or a direct navigation — none are cross-origin threats.
 * We only reject when Origin IS present but NOT in the allowlist.
 */
function applyCORSHeaders(res: NextResponse, origin: string): void {
  res.headers.set("Access-Control-Allow-Origin",      origin);
  res.headers.set("Vary",                             "Origin");
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.set("Access-Control-Allow-Methods",     "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers",     "Content-Type");
}

// ── Middleware ────────────────────────────────────────────────────────────────

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // On Vercel, publish the invocation's request ID as the `vercel-request-id`
  // attribute so middleware telemetry carries it too (the Node runtime picks it
  // up on its own via the Sentry httpServerRequest hook).
  setVercelRequestIdFromHeaders(req.headers);

  // Same idea for the trace ID: adopt Vercel's trace on the isolation scope so
  // errors and logs raised here report the trace Vercel shows for the request.
  setVercelTraceContext();

  // ── Rate limiting (all routes) ──────────────────────────────────────────────
  const { key, limit } = getRateLimitKey(req);
  const { allowed, remaining, resetAt } = checkRateLimit(key, limit);

  if (!allowed) {
    const res = NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)) } },
    );
    applyRateLimitHeaders(res, limit, 0, resetAt);
    return res;
  }

  // ── Auth redirect routes — exempt from CORS check ───────────────────────────
  if (NAVIGATION_PREFIXES.some((p) => pathname.startsWith(p))) {
    const res = NextResponse.next();
    applyRateLimitHeaders(res, limit, remaining, resetAt);
    return res;
  }

  const origin = req.headers.get("origin");

  // ── OPTIONS preflight ───────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    const res = new NextResponse(null, { status: 204 });
    if (origin && ALLOWED_ORIGINS.has(origin)) applyCORSHeaders(res, origin);
    applyRateLimitHeaders(res, limit, remaining, resetAt);
    return res;
  }

  // ── CORS origin check ───────────────────────────────────────────────────────
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Pass through ────────────────────────────────────────────────────────────
  const res = NextResponse.next();
  if (origin) applyCORSHeaders(res, origin);
  applyRateLimitHeaders(res, limit, remaining, resetAt);
  return res;
}

export const config = { matcher: "/api/:path*" };
