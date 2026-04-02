# Allaboard — Claude Code Instructions

## Project Overview

Allaboard is a climbing community platform for logging sessions, sharing climbs, and tracking stats. It's a Next.js 16 App Router app with Route Handlers for the API, backed by PostgreSQL.

**Auth:** Google OAuth (MVP) via `iron-session` (encrypted cookie, no DB lookup per request).

---

## Architecture

```
/
├── src/
│   ├── app/
│   │   ├── api/            # Next.js Route Handlers (replaces Express API)
│   │   │   ├── climbs/route.ts
│   │   │   ├── climbs/[id]/route.ts
│   │   │   ├── users/route.ts
│   │   │   ├── users/[handle]/route.ts
│   │   │   ├── sessions/route.ts
│   │   │   ├── log-entries/route.ts
│   │   │   ├── feed/route.ts
│   │   │   ├── stats/[userId]/route.ts
│   │   │   ├── auth/me/route.ts
│   │   │   ├── auth/logout/route.ts
│   │   │   ├── auth/google/route.ts
│   │   │   └── auth/callback/route.ts
│   │   └── (pages)/        # UI pages
│   ├── components/         # Shared UI components
│   └── lib/
│       ├── types.ts        # Shared TypeScript interfaces
│       ├── utils.ts        # timeAgo(), GRADE_COLORS, ALL_GRADES
│       ├── auth-context.tsx # AuthProvider + useAuth hook
│       ├── server/
│       │   ├── db.ts       # Knex instance (server-only, never imported by client)
│       │   ├── session.ts  # iron-session config + SessionData interface
│       │   └── stats.ts    # computeStats logic
│       └── db/
│           ├── index.ts    # Re-exports from ./remote
│           └── remote.ts   # fetch() calls to /api/* (client-side data layer)
└── api/                    # Migration CLI tooling only (no server code)
    ├── migrations/         # Knex migration files
    ├── seeds/              # Seed data
    └── knexfile.ts         # Knex CLI config
```

### Key rule: server vs client imports
- `src/lib/server/*` — **server-only**. Contains Knex and DB queries. Never import in components or client code.
- `src/lib/db/remote.ts` — **client-safe**. Uses `fetch()` to call `/api/*`. This is what components import.
- `src/app/api/*/route.ts` — **route handlers**. Server-side. Import from `src/lib/server/*`.

---

## Development

```bash
npm run dev
```
Runs Next.js only (port 3000). API routes are served by Next.js at `/api/*`.

---

## Database

**Engine:** PostgreSQL (local: `localhost:5432`, database `allaboard`)
**ORM:** Knex with TypeScript migrations
**Connection:** `DATABASE_URL` env var, or defaults to local postgres

### Common DB commands (run from `api/` or use `--prefix api`)
```bash
npm run migrate --prefix api        # Run pending migrations
npm run rollback --prefix api       # Roll back last migration
npm run seed --prefix api           # Run seeds
npm run db:reset --prefix api       # Rollback + migrate + seed

# First-time setup
npm run db:create --prefix api      # Create the database
npm run db:ping --prefix api        # Check postgres connection
```

### Create a new migration
```bash
cd api && npx tsx knexfile.ts migrate:make <migration_name>
```
Migration files go in `api/migrations/` and are named `YYYYMMDDHHMMSS_description.ts`.

### Migrations that have run (in order)
1. `20260314000001_create_users` — users table
2. `20260314000002_create_climbs` — climbs table
3. `20260314000003_create_beta_videos` — beta_videos table
4. `20260314000004_create_sessions` — climbing sessions table
5. `20260314000005_create_log_entries` — log_entries table
6. `20260328000001_add_auth_fields_to_users` — adds `email`, `profile_picture_url` to users
7. `20260328000002_create_oauth_accounts` — Google OAuth identity → user link
8. `20260328000003_create_auth_sessions` — DB sessions table (kept for schema completeness; not used — iron-session stores session in cookie)
9. `20260328000004_add_picture_to_oauth_accounts` — adds `profile_picture_url` to oauth_accounts (available before users row exists)
10. `20260328000005_create_boards` — boards table; seeded with Kilter Board (Original), Moonboard 2016, Tension Board 1 (TB1)

---

## Database Schema

### `users`
| Column | Type | Notes |
|--------|------|-------|
| id | text | primary key (= handle) |
| handle | text | unique; derived from display_name via `toHandle()` |
| display_name | text | |
| avatar_color | text | Tailwind color class |
| bio | text | |
| home_board | text | board name (e.g. "Kilter Board (Original)") |
| home_board_angle | integer | |
| email | text | from Google |
| profile_picture_url | text | Google account photo |
| joined_at | timestamp | |
| followers_count | integer | |
| following_count | integer | |
| personal_best_kilter | text | grade string |
| personal_best_moonboard | text | grade string |

### `boards`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | primary key |
| name | text | unique; e.g. "Kilter Board (Original)" |
| created_at | timestamp | |

### `climbs`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | primary key |
| name | text | |
| grade | text | V0–V16 |
| board_type | text | Kilter / Moonboard |
| angle | integer | |
| description | text | |
| author | text | FK → users.id |
| setter | text | |
| sends | integer | incremented on log |
| created_at | timestamp | |

### `beta_videos`
| Column | Type | Notes |
|--------|------|-------|
| id | increments | primary key |
| climb_id | UUID | FK → climbs.id |
| url | text | |
| thumbnail | text | |
| platform | text | instagram / youtube |
| credit | text | |
| sort_order | integer | |

### `sessions`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | primary key |
| user_id | text | FK → users.id |
| date | date | unique with user_id |
| board_type | text | |
| angle | integer | |
| duration_minutes | integer | |
| feel_rating | integer | 1–5 |

### `log_entries`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | primary key |
| session_id | UUID | FK → sessions.id |
| climb_id | UUID | FK → climbs.id |
| user_id | text | FK → users.id |
| date | date | |
| attempts | integer | |
| sent | boolean | |
| notes | text | |

---

## Authentication

### Provider
Google OAuth 2.0 only (MVP). Uses Google Cloud Web Application credentials.

### Session: iron-session (encrypted cookie)
- Cookie name: `allaboard_session`; HttpOnly, Secure in production, SameSite=Lax, 30-day max-age
- Payload: `{ oauthAccountId?: string; userId?: string }` (stored encrypted — no DB lookup per request)
- Config: `src/lib/server/session.ts` — reads `SESSION_SECRET` env var (must be 32+ chars)
- `userId` is absent/undefined until onboarding completes; `oauthAccountId` is set after Google callback

### Auth flow

```
1. User clicks "Login with Google"
2. GET /api/auth/google → generates random state, stores in oauth_state cookie, redirects to Google
3. Google redirects to GET /api/auth/callback?code=...&state=...
4. Verifies state cookie (CSRF), exchanges code for tokens, fetches userinfo from Google
5a. Existing user (oauth_accounts.user_id is set):
     → session.oauthAccountId = ..., session.userId = handle → redirect to /
5b. New Google account (no oauth_accounts row or user_id = null):
     → Upsert oauth_accounts, session.oauthAccountId = ..., session.userId = undefined → redirect to /onboarding
6. Onboarding: user enters display name (handle derived via toHandle()):
     → POST /api/onboarding → creates users row, links oauth_accounts.user_id, session.userId = handle
     → Redirect to /
7. Logout: POST /api/auth/logout → session.destroy()
```

### Resolving the current user in a route handler
```typescript
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions, type SessionData } from "@/lib/server/session";

const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
if (!session.userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
// session.userId is the user's handle (= users.id)
```

### `oauth_accounts` table
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | primary key |
| provider | text | `'google'` |
| provider_user_id | text | Google `sub` claim; unique per provider |
| email | text | from Google ID token |
| profile_picture_url | text | nullable |
| user_id | text | FK → users.id, **null until onboarding complete** |
| access_token | text | nullable |
| refresh_token | text | nullable |
| token_expires_at | timestamp | nullable |
| created_at | timestamp | |
| updated_at | timestamp | |

### Unauthenticated access rules
- Activity feed: visible (but cannot filter to "following" only)
- Climb directory: visible
- Climb detail: visible
- Logging a climb: requires auth
- Profile page: requires auth
- Stats page: requires auth
- Navbar profile icon: shows "Login" link when logged out

---

## Resource Specifications

### Climbs

#### Overview
A climb is the core content unit of allaboard. Climbs are browsable by everyone; only authenticated users may submit new climbs or tick them.

#### Data model

**`climbs` table** (pending migrations noted below):
| Column | Type | Notes |
|--------|------|-------|
| id | UUID v4 | primary key |
| name | text | |
| grade | text | V0–V18 |
| board_id | UUID | FK → boards.id (**replaces `board_type` text column**) |
| angle | integer | 0–90; default 40 |
| description | text | optional |
| author | text | FK → users.id; the user who submitted the climb (protected resource owner) |
| setter | text | free-form name; independent from author; nullable |
| star_rating | numeric | aggregated average from `ticks.rating`; updated on each tick |
| sends | integer | incremented on each tick where `sent = true` |
| created_at | timestamp | |

**Unique constraint:** `(name, angle, grade, board_id)` — prevents duplicate climbs on the same board.

**`beta_videos` table** (instagram links only):
| Column | Type | Notes |
|--------|------|-------|
| id | increments | primary key |
| climb_id | UUID | FK → climbs.id (CASCADE delete) |
| url | text | full instagram post/reel URL pasted by the user |
| thumbnail | text | thumbnail image URL (derived from instagram embed or stored externally) |
| sort_order | integer | |

**`ticks` table** (new — to be migrated):
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | primary key |
| climb_id | UUID | FK → climbs.id (CASCADE delete) |
| user_id | text | FK → users.id; the climber who ticked it |
| suggested_grade | text | V0–V18; the climber's grade opinion |
| rating | integer | 1–4 stars |
| comment | text | nullable; free-form send notes |
| instagram_url | text | nullable; instagram video of the send |
| sent | boolean | true = completed, false = attempted only |
| created_at | timestamp | |

**Unique constraint on `ticks`:** `(climb_id, user_id)` — one tick per user per climb.

#### Pending migrations
The following schema changes are required before the climbs page is fully implemented:
1. Replace `climbs.board_type` (text) with `climbs.board_id` (UUID FK → boards)
2. Extend grade range from V16 → V18 (data only, no schema change needed since grade is stored as text)
3. Add `climbs.star_rating` numeric column
4. Add unique constraint on `(name, angle, grade, board_id)` to climbs
5. Create `ticks` table with unique constraint on `(climb_id, user_id)`
6. Drop `beta_videos.platform` and `beta_videos.credit` columns (instagram-only, no credit field)

#### Climbs list page (`/climbs`)
- Sorted alphabetically by name by default
- Search bar filters by name (client-side or server-side debounced query param)
- Filter by **grade** (multi-select, V0–V18)
- Filter by **angle** (numeric range slider or min/max inputs, 0–90)
- Authenticated users see a **"Submit Climb"** button; unauthenticated users do not
- Each climb card shows: name, grade badge, board name, angle, star rating, send count

#### Climb detail page (`/climbs/[id]`)
- Shows all climb metadata: name, grade, board, angle, setter, star rating, send count
- Instagram video thumbnails listed below — each is a clickable link to the instagram post
- **Tick button** — visible to all authenticated users
  - Opens a modal with:
    - Suggested grade (V0–V18 select)
    - Rating (1–4 stars — use a star-rating UI component)
    - Comment (textarea, optional)
    - Instagram video URL of their send (optional)
  - On submit: creates/updates a `ticks` row, recalculates and updates `climbs.star_rating`, increments `climbs.sends` if `sent = true`
- **Edit controls** (name, grade, board, angle, setter, instagram links) — only rendered when `useAuth().user?.id === climb.author` (ACL rule)

#### ACL
- **View:** public — no auth required
- **Submit new climb:** requires auth (`session.userId` must be set)
- **Edit / delete climb:** only the `author` (the user who submitted it)
- **Tick a climb:** requires auth; one tick per user per climb (upsert on resubmit)

---

## Access Control (ACL)

### Core rule
All resources (climbs, sessions, log entries, profiles) are **publicly viewable** across allaboard.dev. A resource is a **protected resource** when it has an owner — identified by the `users.id` (handle) of the user who created it.

**Only the owning user may edit or delete their own protected resources.**

### What "owner" means per resource type
| Resource | Owner column |
|----------|-------------|
| `climbs` | `climbs.author` |
| `sessions` | `sessions.user_id` |
| `log_entries` | `log_entries.user_id` |
| `ticks` | `ticks.user_id` |
| `users` (profile) | `users.id` itself |

### Enforcement rules

**Only the user who created a protected resource may edit or delete it.** No admin override exists in the current implementation.

**API route handlers (PATCH / PUT / DELETE):**
- Read `session.userId` from iron-session.
- Compare against the resource's owner column.
- Return **403** if `session.userId !== resource.owner`. Return **401** if not logged in at all.
- Never trust an owner value sent from the client — always derive it server-side from the session.

**Frontend / UI:**
- Edit/delete controls (buttons, forms, menus) are only rendered when `useAuth().user?.id === resource.ownerId`.
- Pages are still rendered and all data is shown to every visitor — only the edit/delete affordances are hidden.

### Pattern for a protected mutation handler
```typescript
const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
if (!session.userId) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

const resource = await db("table").where({ id }).first();
if (!resource) return NextResponse.json({ error: "Not found" }, { status: 404 });
if (resource.owner_column !== session.userId)
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });

// safe to mutate
```

---

## API Endpoints

All routes are Next.js Route Handlers served under `/api/*` by the Next.js dev server and Vercel in production.

| Method | Path | Handler file |
|--------|------|-------------|
| GET | `/api/health` | `src/app/api/health/route.ts` |
| GET | `/api/climbs` | `src/app/api/climbs/route.ts` |
| POST | `/api/climbs` | `src/app/api/climbs/route.ts` |
| GET | `/api/climbs/:id` | `src/app/api/climbs/[id]/route.ts` |
| GET | `/api/users` | `src/app/api/users/route.ts` |
| GET | `/api/users/:handle` | `src/app/api/users/[handle]/route.ts` |
| PATCH | `/api/users/:handle` | `src/app/api/users/[handle]/route.ts` |
| GET | `/api/sessions?userId=` | `src/app/api/sessions/route.ts` |
| POST | `/api/sessions` | `src/app/api/sessions/route.ts` |
| POST | `/api/log-entries` | `src/app/api/log-entries/route.ts` |
| GET | `/api/feed?userId=` | `src/app/api/feed/route.ts` |
| GET | `/api/stats/:userId` | `src/app/api/stats/[userId]/route.ts` |
| DELETE | `/api/ticks/:id` | `src/app/api/ticks/[id]/route.ts` |
| GET | `/api/auth/me` | `src/app/api/auth/me/route.ts` |
| POST | `/api/auth/logout` | `src/app/api/auth/logout/route.ts` |
| GET | `/api/auth/google` | `src/app/api/auth/google/route.ts` |
| GET | `/api/auth/callback` | `src/app/api/auth/callback/route.ts` |
| GET | `/api/boards` | `src/app/api/boards/route.ts` |
| GET | `/api/users/check-handle?handle=` | `src/app/api/users/check-handle/route.ts` |
| POST | `/api/onboarding` | `src/app/api/onboarding/route.ts` |

---

## Frontend Pages

| Route | File | Description |
|-------|------|-------------|
| `/` | `src/app/page.tsx` | Home feed |
| `/climbs` | `src/app/climbs/page.tsx` | Climb directory with filters |
| `/climbs/[id]` | `src/app/climbs/[id]/page.tsx` | Climb detail + beta videos |
| `/climbs/new` | `src/app/climbs/new/page.tsx` | Submit new climb |
| `/profile` | `src/app/profile/page.tsx` | Current user profile |
| `/stats` | `src/app/stats/page.tsx` | Stats dashboard |
| `/onboarding` | `src/app/onboarding/page.tsx` | First-time setup after Google OAuth (display name, home board, max grade) |

---

## Key Types (`src/lib/types.ts`)

```typescript
type Grade = "V0" | "V1" | ... | "V16"
type BoardType = "Kilter" | "Moonboard"

interface Climb { id, name, grade, boardType, angle, description, betaVideos, author, setter, createdAt, sends }
interface User { id, handle, displayName, avatarColor, bio, homeBoard, homeBoardAngle, joinedAt, followersCount, followingCount, personalBests }
interface Session { id, userId, date, boardType, angle, durationMinutes, logEntries, feelRating }
interface LogEntry { id, climbId, userId, date, attempts, sent, notes }
interface ClimberStats { gradePyramid, sessionFrequency, progressOverTime, attemptsVsSends, totalSends, totalAttempts, currentStreak }
interface FeedActivity { id, user, climb, date, attempts, sent, notes }
```

---

## Penetration Testing

### Scripts

Two scripts in `scripts/` automate the pen test workflow:

| Script | Purpose |
|--------|---------|
| `scripts/mint-session.mjs` | Mints a valid iron-session cookie for a given `userId` — used to authenticate curl requests without a real Google login |
| `scripts/pentest.sh` | Runs a full live pen test against the running dev server: CORS rejection, 401 (unauth), 403 (non-owner), and 2xx (owner) for every protected resource |

### How to run a pen test

1. Start the dev server: `npm run dev`
2. Run the automated script:

```bash
OWNER_HANDLE=yourhandle NONOWNER_HANDLE=otherhandle bash scripts/pentest.sh
```

`SESSION_SECRET` is read from the environment; if unset the dev default is used (matches what `npm run dev` uses when `SESSION_SECRET` is not in `.env.local`).

The script covers:
1. **No `Origin` header** → must return **403** (CORS rejection — blocks curl, arbitrary domains)
2. **Unauthenticated** (no cookie) → must return **401**
3. **Authenticated as non-owner** → must return **403**
4. **Authenticated as owner** → must succeed (**200/201**)
5. **Auth redirect routes** (`/api/auth/google`, `/api/auth/callback`, `/api/health`) → reachable without `Origin` (browser navigations)

**Minting a cookie manually** (for one-off curl requests):
```bash
COOKIE=$(node scripts/mint-session.mjs yourhandle)
curl -H "Cookie: $COOKIE" -H "Origin: http://localhost:3000" \
     http://localhost:3000/api/auth/me
```

> **Note:** All API requests must include `Origin: http://localhost:3000` (or an allowed production origin). Requests without a recognised `Origin` are rejected with 403 by the CORS middleware before they reach the route handler.

**Protected resources and their owner columns:**
| Resource | Mutation endpoints | Owner check |
|---|---|---|
| `users` | `PATCH /api/users/[handle]` | `session.userId === handle` |
| `climbs` | `PATCH /api/climbs/[id]` | `session.userId === climb.author` |
| `ticks` | `PATCH /api/ticks/[id]`, `DELETE /api/ticks/[id]` | `session.userId === tick.user_id` |
| `sessions` | `POST /api/sessions` | `session.userId === body.userId` |
| `log_entries` | `POST /api/log-entries` | `session.userId === body.userId` |
| `boards` | `PATCH /api/boards/[id]` | `session.userId === board.created_by` |
| `follows` | `POST/DELETE /api/users/[handle]/follow` | `session.userId` must be set (follower is always the caller) |

### Important: clean up after testing

Live tests against the dev server write real data. After a pen test:
- Delete any spurious rows created (sessions, log_entries, ticks) via direct DB query or the UI
- Restore any fields that were overwritten (bio, displayName, etc.)
- Use a throwaway test user where possible to avoid corrupting real data

### When to run a pen test

Run a pen test after any of the following:
- A new API endpoint is added
- An existing endpoint gains a new mutation method (POST/PATCH/DELETE)
- Auth or session logic changes
- CORS or middleware configuration changes

---

## Testing Policy

When adding a new feature, new tests may be added to cover that feature. However, **do not modify existing tests** as part of a feature or bug-fix prompt — existing tests serve as a regression baseline and should remain unchanged unless explicitly instructed to update them. Test updates should be requested in a separate, subsequent prompt from the one that introduced the feature or change.

---

## Adding New Features — Common Patterns

### Add a new API endpoint
1. Create `src/app/api/<route>/route.ts` exporting named functions `GET`, `POST`, `PATCH`, `DELETE` etc.
2. For dynamic segments use `src/app/api/<route>/[param]/route.ts` — params arrive as `{ params: Promise<{ param: string }> }` (always `await params`)
3. Import DB from `@/lib/server/db` (server-only)
4. Return `NextResponse.json(data)` or `NextResponse.json(data, { status: 201 })`
5. Add the `fetch` call in `src/lib/db/remote.ts` using the `/api/...` path
6. Add the TypeScript type in `src/lib/types.ts` if needed
7. Add or update JSDoc doc strings on every exported handler function — describe the purpose, auth requirements, key query params or body fields, and possible response codes

### Route handler template
```typescript
import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/server/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = await db("table").where({ id }).first();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
```

### Add a new database table
1. Create migration: `cd api && npx tsx knexfile.ts migrate:make <name>`
2. Write the migration in `api/migrations/<timestamp>_<name>.ts`
3. Run it: `npm --prefix api run migrate`
4. Add TypeScript type in `src/lib/types.ts`

### Add a new page
1. Create directory under `src/app/<route>/`
2. Add `page.tsx` (server component by default; add `"use client"` for interactivity)
3. Add navigation link in `src/components/Navbar.tsx` if needed

### Add a new component
- Place in `src/components/`
- Follow existing pattern: dark Tailwind theme (stone-950 bg, orange-500 accents, stone-700 borders)

---

## Style Conventions

- **Theme:** Dark — `bg-stone-950`, `bg-stone-900` cards, `border-stone-700`, `text-stone-400` secondary
- **Accent:** `orange-500` (buttons, highlights, grade badges)
- **Grade colors:** Use `GRADE_COLORS` from `src/lib/utils.ts` — maps V-grades to Tailwind color classes
- **Fonts:** Geist Sans + Geist Mono (loaded in `src/app/layout.tsx`)
- **Images:** External images must be allowlisted in `next.config.ts` (currently `picsum.photos`)

---

## Deployment

### Architecture
Everything deploys as a single Vercel project. There is no separate API server.

| Part | Platform | Notes |
|------|----------|-------|
| Next.js frontend + API routes | **Vercel** | Single deployment |
| Migration CLI | runs during Vercel build | `api/knexfile.ts` + `api/migrations/` |

### Database: Neon (production) / local Postgres (development)
Knex reads connection config from `api/knexfile.ts`:
- **Local**: no env vars set → connects to `localhost:5432` database `allaboard` (no SSL)
- **Neon**: reads `DATABASE_URL_UNPOOLED` first, then `DATABASE_URL`, with `ssl: { rejectUnauthorized: false }`

**Why `DATABASE_URL_UNPOOLED`?** Neon's Vercel integration provides both a pooled connection (PgBouncer) and a direct connection. Knex uses `pg_advisory_lock` during migrations, which breaks under PgBouncer's transaction mode. Always use the direct/unpooled connection. For a long-running Express server, direct is also preferred since Knex manages its own connection pool.

### Vercel (frontend + migration runner)
Vercel uses the `vercel-build` npm script:
```
npm --prefix api run migrate && next build
```
This runs Knex migrations against the production database **before** building Next.js.

**Required Vercel environment variables** (set in Project → Settings → Environment Variables):
| Variable | Source | Description |
|----------|--------|-------------|
| `DATABASE_URL_UNPOOLED` | Neon integration (auto) | Direct Neon connection — used by migrations and route handlers |
| `DATABASE_URL` | Neon integration (auto) | Pooled Neon connection — fallback if above absent |
| `GOOGLE_CLIENT_ID` | Manual | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Manual | Google OAuth client secret |
| `SESSION_SECRET` | Manual | iron-session key; generate: `openssl rand -hex 32` |

The Neon Vercel integration sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED` automatically when you connect a Neon project in the Vercel dashboard.

There is no separate API server deployment. All routes are handled by Next.js on Vercel.

### Google OAuth environment variables
| Variable | Where | Notes |
|----------|-------|-------|
| `GOOGLE_CLIENT_ID` | `.env` (root) | Auto-loaded by Next.js |
| `GOOGLE_CLIENT_SECRET` | `.env` (root) | Auto-loaded by Next.js |

The callback URL is derived from the incoming request's `origin` — no env var needed. It resolves to `http://localhost:3000/api/auth/callback` locally and `https://www.allaboard.dev/api/auth/callback` in production. Both must be registered in Google Cloud Console.

### How Next.js loads environment variables
Next.js automatically loads these files (in priority order, highest last):
1. `.env` — committed defaults, loaded everywhere
2. `.env.local` — local overrides, gitignored, loaded everywhere
3. `.env.production` / `.env.development` — environment-specific

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` live in `.env` (gitignored via `.env*`). Only `NEXT_PUBLIC_` prefixed vars are sent to the browser — all others are server-only.

---

## Environment Variables

| Variable | Where | Description |
|----------|-------|-------------|
| `GOOGLE_CLIENT_ID` | `.env` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | `.env` | Google OAuth client secret |
| `SESSION_SECRET` | `.env.local` / Vercel | iron-session encryption key; **must be 32+ chars**. Generate: `openssl rand -hex 32` |
| `DATABASE_URL_UNPOOLED` | Vercel (Neon auto) | Direct Neon connection — used for migrations and route handlers |
| `DATABASE_URL` | Vercel (Neon auto) | Pooled Neon connection — fallback if above absent |
| `PGUSER` | `.env.local` | Postgres user for local dev (only if differs from OS user) |
| `META_APP_ACCESS_TOKEN` | `.env.local` / Vercel | `{App ID}|{Client Token}` from a Meta Developer app — required for Instagram oEmbed thumbnail fetching |

`SESSION_SECRET` must also be added to Vercel Project → Settings → Environment Variables.
