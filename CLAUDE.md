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

### Denormalization policy

**All denormalized columns must be maintained by a PostgreSQL trigger, never by application code.**

Counters and aggregates that duplicate data already derivable from another table (e.g. `followers_count`, `following_count`, `sends`, `star_rating`) must be kept in sync via an `AFTER INSERT OR UPDATE OR DELETE` trigger on the source table. Application code must not increment, decrement, or recalculate these values — doing so risks drift whenever rows are inserted or deleted outside the normal API path (seeds, migrations, scripts, direct DB access).

When adding a new denormalized column:
1. Write a migration that creates the trigger function and attaches it to the source table.
2. Include a resync statement in the migration (`UPDATE … SET col = (SELECT …)`) so existing rows start in a consistent state.
3. Do **not** add application-code fallback logic — the trigger is the single source of truth.

Existing triggers:
| Trigger | Source table | Columns maintained |
|---|---|---|
| `follows_count_sync` | `follows` | `users.followers_count`, `users.following_count` |
| `ticks_climb_stats_sync` | `ticks` | `climbs.sends`, `climbs.star_rating` |
| `tick_sessions_sync` | `ticks` | entire `tick_sessions` table (rebuilds affected user's sessions) |

> `tick_sessions_sync` is scoped to `UPDATE OF date, user_id, sent, duration_minutes` (plus all INSERT/DELETE) so rating/comment-only edits don't rebuild, and it only ever writes `tick_sessions` (never `ticks`), so it can't recurse or disturb `ticks_climb_stats_sync`.

---

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
11. `20260722000001_add_duration_to_ticks` — adds `duration_minutes` (nullable) to ticks
12. `20260722000002_create_tick_sessions` — tick_sessions table (denormalized climbing sessions)
13. `20260722000003_tick_sessions_trigger` — `grade_rank()`, `recompute_tick_sessions()`, `tick_sessions_sync` trigger, and backfill of existing sessions
14. `20260815000001_create_session_images` — session_images table (AI-generated session header banners)
15. `20260815000002_add_attempts_to_session_images` — adds `attempts` so a failed banner retries a bounded number of times

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

### `tick_sessions`
Denormalized climbing sessions, derived entirely from `ticks` and maintained by the `tick_sessions_sync` trigger (never written by application code). A session is a user's ticks logged within 6 hours of each other (consecutive-gap grouping).

| Column | Type | Notes |
|--------|------|-------|
| id | text | primary key; deterministic slug `<handle>-YYYY-MM-DD-<n>` (stable permalink) |
| user_id | text | FK → users.id (CASCADE) |
| date | date | calendar day of the first tick |
| session_number | integer | 1-based ordinal within `date` (2nd+ session that day → title suffix "Session 2", …) |
| started_at | timestamp | first tick timestamp (defines the membership window) |
| ended_at | timestamp | last tick timestamp |
| tick_count | integer | |
| sent_count | integer | |
| hardest_grade | text | hardest *sent* grade (via `grade_rank`); null if nothing sent |
| total_minutes | integer | sum of recorded `duration_minutes`; null if none recorded |
| created_at | timestamp | |

Session membership is defined by the `[started_at, ended_at]` window (no FK on `ticks`), so the detail view reads live tick data. `grade_rank(text)` is an immutable SQL helper ordering the V-scale (incl. `V5+`/`V8+`).

### `session_images`
One AI-generated header banner per climbing session (see **Session Header Images** below).

| Column | Type | Notes |
|--------|------|-------|
| session_id | text | primary key; the `tick_sessions` slug. **No FK** — see note below |
| user_id | text | FK → users.id (CASCADE) |
| status | text | `pending` \| `ready` \| `failed`; doubles as the generation lock |
| attempts | integer | generation attempts spent; capped at 3 before the session is left alone |
| model | text | image model that produced `data` |
| prompt | text | the generated image prompt (kept for debugging) |
| mime_type | text | e.g. `image/jpeg` |
| data | bytea | image bytes; null until `status = 'ready'` |
| error | text | failure reason when `status = 'failed'` |
| created_at / updated_at | timestamp | |

> **Why a separate table and no FK to `tick_sessions`?** The `tick_sessions_sync` trigger rebuilds a user's sessions with DELETE + INSERT on every tick change, so anything stored on that row (or any FK pointing at it) is destroyed the next time the climber logs a climb. The session slug is deterministic and survives those rebuilds, which makes it a stable key. The FK to `users` is what cleans these rows up.

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
| attempts | integer | nullable; null = "a bunch" |
| duration_minutes | integer | nullable; minutes spent working the climb this session; null = no time recorded |
| date | timestamp | when the tick happened |
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
| GET | `/api/tick-sessions?userId=` | `src/app/api/tick-sessions/route.ts` |
| GET | `/api/tick-sessions/:id` | `src/app/api/tick-sessions/[id]/route.ts` |
| GET | `/api/tick-sessions/:id/image` | `src/app/api/tick-sessions/[id]/image/route.ts` |
| POST | `/api/tick-sessions/:id/image` | `src/app/api/tick-sessions/[id]/image/route.ts` |
| GET | `/api/tick-sessions/:id/image/raw` | `src/app/api/tick-sessions/[id]/image/raw/route.ts` |
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
| `/user/[handle]/sessions` | `src/app/user/[handle]/sessions/page.tsx` | List of a user's climbing sessions ("My Sessions") |
| `/user/[handle]/sessions/[id]` | `src/app/user/[handle]/sessions/[id]/page.tsx` | Session detail + permalink (stats, copy summary, climb cards) |

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
| `session_images` | `POST /api/tick-sessions/[id]/image` | any authenticated user (`session.userId` set); ownership only gates `?retry=1` |

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

## Logging

Logs are the default tool for understanding runtime behavior — cheap to add, and fine to remove once they've served their purpose. Be intentional: log the minimum needed to debug and operate the app. Structured logs go through Sentry (`Sentry.logger.*`); logging is enabled via `enableLogs: true` in all three `sentry.*.config.ts` files.

### When to log
- **Runtime decisions** — when the app branches (feature flags, redirects, paid vs. free tiers), log why the decision was made and what resulted. Makes cohort-specific bugs reproducible.
- **Multi-step features** — log intermediate outcomes of pipelines (e.g. imports) so you can see *which* stage broke. Log a start record and a flat breakdown of the result.
- **Audit / forensic events** — creates, updates, deletes, access, and permission changes. Capture who, what, and when. Useful for support root-causing and sometimes legally required.
- **Error context** — for failures that don't (yet) throw, e.g. a retry loop or a 4xx from an upstream service. Prefer `Sentry.captureException()` for real exceptions (issue grouping, triage, Autofix); use a log line for the lead-up (retry count, upstream status code, decisions made). Don't duplicate a captured exception with a log message.

### How to write logs
- **Who / what / when** — set request-scoped identity once on `Sentry.getIsolationScope()` (done in `resolveUserId`); later logs in the request inherit it. Sentry adds trace context automatically.
- **Levels** — `debug` (local only; filter before sending), `info` (most records), `warn` (recoverable, needs attention), `error` (non-exception failures such as an upstream 4xx).
- **Structured, flat, scalar** — log flat objects of strings / numbers / booleans / null. Use snake_case keys with dot notation for nesting (`user.id`, `http.response.status_code`, `import.skipped.unknown_grade`). Extract the specific fields you'll search or alert on; never log raw objects.

  **Why snake_case, not camelCase?** Log keys aren't code variables — they're indexed and queried in other systems (Datadog, Elasticsearch, CloudWatch). snake_case wins there: tokenizers split `user_id` into `user`/`id` so partial searches hit, where `userId` is one opaque token. Acronyms stay clean (`http_response_code`, not `httpResponseCode`), and exact casing is preserved where it carries meaning (`pressure_kPa`). It's the lowest-common-denominator across polyglot services (TS/Python/Go), avoiding duplicate `userId`/`user_id`/`UserID` keys in one dashboard. And underscores read as spaces — `failed_login_attempts` parses faster than `failedLoginAttempts`, especially at 3 AM and for non-native English readers.

### What NOT to log
- **Every function call or line** — that's what tracing and profiling are for.
- **PII / secrets** — prefer opaque IDs (the user handle) over emails or names; never log passwords, tokens, or API keys. Be mindful of regulated data (age, gender, postal code) and standards like PCI, GDPR, CCPA, HIPAA.
- **Large blobs** — full requests/responses, LLM prompts, webhook bodies. They carry both cost (volume-based billing) and risk (embedded secrets/PII). Log the specific fields you need instead.

### Filtering & sampling
Not all data is worth keeping. Use `beforeSend` / `beforeSendLog` to drop `debug` and development-environment logs and to scrub sensitive fields. Structured keys make selective censoring or dropping straightforward.

---

## Session Header Images

Each climbing session permalink (`/user/:handle/sessions/:id`) carries a 1200×400 AI-generated banner: a visual read of what that session *felt* like, drawn from the climbs the climber logged and the notes they wrote.

### Pipeline

Two model calls through the **Vercel AI Gateway** (`AI_GATEWAY_API_KEY`), both in `src/lib/server/sessionImage.ts`:

1. **Art direction** (`AI_PROMPT_MODEL`, default `anthropic/claude-sonnet-5`) — reads the session brief and writes a single image prompt. Three constraints live in the system prompt so nothing in the notes can dilute them: the **notes outrank the climb names** (a name may suggest a motif, but the notes decide the mood); **at least three specifics of the session** (a note's image, a name's motif, a grade, an attempt count, hours spent) must be woven into **one coherent scene** rather than a collage, so the banner is recognisably *this* session; and the image must contain **no text of any kind**.

   The house style is a legible bouldering gym — chalked plastic holds and volumes on an overhanging wall, mats, tape, dim rafters — drawn as **cel-shaded anime** in the cinematic register of Ghost in the Shell but a shade lighter and warmer, in dark charcoal + warm stone with one ember-orange accent, generous negative space, and one quiet deadpan visual joke.
2. **Render** (`AI_IMAGE_MODEL`, default `bfl/flux-2-max`) — renders that prompt at exactly `1200x400`.

> **Why Flux 2?** It honours arbitrary aspect ratios and returns exactly 1200×400. The OpenAI image models reject anything outside 1024×1024 / 1536×1024 / 1024×1536, Imagen is limited to a fixed set of ratios, and Seedream enforces a ~3.7 MP minimum — all of which would need cropping. `bfl/flux-2-pro` is a faster (~8s vs ~17s) alternative if latency matters more than composition.

### Generate-once semantics

A **successful** banner is generated once and never regenerated, even after new climbs are logged into that session. `POST` claims the job by inserting a `pending` row with `ON CONFLICT DO NOTHING`, so concurrent page views can never both pay for an image.

### Failure and retry

Image generation fails transiently — a malformed gateway response, an upstream 5xx. Recovery is bounded at three levels:

1. **In-request** — `renderWithRetry` retries the image call once. The AI SDK retries its own retryable errors but treats a malformed response body as terminal, which is the failure seen in practice ("Invalid JSON response" after a full ~22s render). Worst case ~50s, inside the route's 60s budget.
2. **Across visits** — a `failed` row is re-claimed and retried on the next page view while `attempts < MAX_ATTEMPTS` (3). A `pending` row stranded over five minutes by a dead process is reclaimed the same way. The server reports this as `canRetry` so the retry budget lives in one place.
3. **Manual** — once the budget is spent the owner sees a quiet "Couldn't picture this session · Try again"; that button POSTs `?retry=1`, which resets `attempts` (it does *not* bypass the `pending` lock).

> **Why bother:** the original design had no way back from `failed` — the client only POSTed when status was `none`, so a single transient flake left the session permanently blank with no feedback. The server's reclaim path existed but was unreachable.

Failures are stored via `describeError`, which flattens the AI SDK's status code, response body, and nested cause into one searchable line — bare `err.message` yields uninformative strings like "Invalid JSON response". The same failures go to Sentry tagged `feature: session_image`.

### What gets logged

### ACL

- **Trigger generation** (`POST`): any authenticated user, for any session — a session earns its banner on the first visit by anyone signed in, not only its owner. Sign-in is still required because each call costs real inference and should be attributable to an account.
- **Manual retry** (`POST ?retry=1`): the session owner only. The `attempts` cap is what stops a session that keeps failing from being retried by everyone who opens it, so only the owner may reset it; for anyone else the flag is ignored (treated as an ordinary POST). The "Try again" affordance is likewise rendered for the owner only.
- **View** (`GET` status and `GET .../raw`): public, like the session itself. A signed-out visitor never triggers generation and renders nothing where a banner has yet to be made.
- **Row ownership**: `session_images.user_id` is always the session's climber, never the visitor who triggered generation — that column is what CASCADE-deletes the banner with its account, so it has to follow the session.

### Frontend

`src/components/SessionHeaderImage.tsx` owns the whole lifecycle. Generation takes ~20–30s inline, so the component shows a placeholder sized exactly like the finished banner (no layout shift): a dim stone gradient with a slow `animate-banner-sweep` warm sweep, defined in `globals.css` and disabled under `prefers-reduced-motion`. The image fades in on `load`.

The component POSTs when status is `none`, **or** when it is `failed` and the server still reports `canRetry` — that second case is what makes a transient failure heal itself on the next visit. A visitor never triggers generation and never sees a failure state; a missing banner simply renders nothing rather than an empty 400px frame.

---

## API Documentation

Interactive API docs are served at `/api-docs` via [Scalar](https://scalar.com).
The spec is a generated `public/openapi.yaml` derived from the TSDoc comments in the route handlers.

### How the spec is generated

- **Source:** JSDoc on every exported `GET` / `POST` / `PATCH` / `DELETE` / `PUT` function in `src/app/api/**\/route.ts`
- **Generator:** `scripts/generate-openapi.mjs` — run with `npm run generate:openapi`
- **Output:** `public/openapi.yaml` (served as a static file by Next.js)

### When the spec is (re)generated

| Trigger | Mechanism |
|---------|-----------|
| `npm run dev` | Generator runs once before Next.js starts; `src/instrumentation.ts` then watches `src/app/api/**/*.ts` and regenerates on every save |
| `npm run build` / `npm run vercel-build` | Generator runs as part of the build script before `next build` |
| Manual | `npm run generate:openapi` |

### JSDoc format expected by the generator

The generator extracts:
- **Summary** — first paragraph of the function JSDoc
- **Auth** — `**Authentication:** Required` / `Not required` text sets `security` on the operation
- **Query params** — bullet list items under `@param req` when the handler is `GET`
- **Body fields** — bullet list items under `@param req` when the handler is `POST`/`PATCH`/`PUT`
- **Response codes** — `@returns \`NNN\`` tags; the first tagless `@returns` becomes the 200 description

---

## Grade Scales

### V-scale (used internally)

All grades stored in the database and displayed in the UI use the **V-scale** (`Grade` type in `src/lib/types.ts`). The canonical ordered list is `ALL_GRADES` in `src/lib/utils.ts`.

### Font-scale conversion

When importing or consuming external data that uses the Font scale (e.g. Kilter Board API, third-party logbooks), convert to V-scale using the table below. Some lower V-grades map from two Font grades — treat both as the same V-grade.

| V-grade | Font grade(s) |
|---------|--------------|
| V0  | 4      |
| V1  | 5      |
| V2  | 5+     |
| V3  | 6a, 6a+ |
| V4  | 6b, 6b+ |
| V5  | 6c     |
| V5+ | 6c+    |
| V6  | 7a     |
| V7  | 7a+    |
| V8  | 7b     |
| V8+ | 7b+    |
| V9  | 7c     |
| V10 | 7c+    |
| V11 | 8a     |
| V12 | 8a+    |
| V13 | 8b     |
| V14 | 8b+    |
| V15 | 8c     |
| V16 | 8c+    |
| V17 | 9a     |
| V18 | 9a+    |

Any import script or API integration that receives Font-scale grades must convert them to V-scale before writing to the database. The mapping is one-way for storage — always store V-scale.

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

### Multi-select dropdown

Whenever a multi-select control is needed, use the custom `BoardSelect`-style pattern from `src/app/stats/page.tsx` — **do not use a native `<select multiple>`**. The pattern:

- A styled button showing the current selection label (`"All <things>"` when nothing selected, the single item name when one is chosen, `"N <things>"` when multiple are checked)
- A chevron icon that rotates 180° when open
- A dropdown panel (`bg-stone-800 border border-stone-700 rounded-lg shadow-2xl z-20`) that closes on outside click via a `mousedown` listener attached in a `useEffect`
- An **"All …"** checkbox at the top that clears the selection, followed by a divider, then one labeled checkbox per option
- Checkboxes use `accent-orange-500`
- The component is self-contained (owns its `open` state, accepts `selected: string[]` + `onChange` props)

---

### Tick List Card

The canonical UI element for displaying a user's tick in a list. Reference implementation: `TickCard` in `src/app/user/[handle]/page.tsx`.

Structure (top-to-bottom, left-to-right):

- **Container:** `bg-stone-800 border border-stone-700 rounded-xl p-4`
- **Left column** (`flex-1 min-w-0`):
  - **Row 1 — headline:** sent/working status badge + `<GradeBadge>` + climb name as a `<Link href="/climbs/[id]">` (white, `hover:text-orange-400`)
    - Sent: `text-green-400 text-xs font-semibold` label `"Sent"`
    - Working: `text-stone-400 text-xs` label `"Working"`
  - **Row 2 — meta:** `<StarRating size="sm">` · board name & angle (`text-stone-500 text-xs`) · attempt count (`text-stone-500 text-xs`) · relative time via `timeAgo()` (`text-stone-600 text-xs`)
  - **Row 3 — comment** (optional): `text-stone-400 text-sm leading-relaxed`
- **Right column** (`shrink-0`, owner-only): `"Edit"` button (`hover:text-orange-400`) and `"Delete"` button (`hover:text-red-400`), both `text-xs text-stone-500`

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
| `AI_GATEWAY_API_KEY` | `.env.local` / Vercel | Vercel AI Gateway key — required for session header images and `npm run ai:hello` |
| `AI_PROMPT_MODEL` | optional | Overrides the art-direction model (default `anthropic/claude-sonnet-5`) |
| `AI_IMAGE_MODEL` | optional | Overrides the image model (default `bfl/flux-2-max`) |

`SESSION_SECRET` must also be added to Vercel Project → Settings → Environment Variables.
