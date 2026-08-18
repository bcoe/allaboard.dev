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
| status | text | `ready` \| `failed`. Only finished outcomes are written — a row exists because a generation ended, never because one started. `pending` is a client-facing status and a legacy value some rows still carry; see **Generate-once semantics** |
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
All resources (climbs, sessions, log entries, profiles) are **publicly viewable** across allaboard.dev — with one exception, `stats_notes`, which is owner-only on read as well (see **Stats Notes**). A resource is a **protected resource** when it has an owner — identified by the `users.id` (handle) of the user who created it.

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
| POST | `/api/users/:handle/import/mountain-project` | `src/app/api/users/[handle]/import/mountain-project/route.ts` — CSV → outdoor day notes; owner-only |
| GET | `/api/users/:handle/stats-notes` | `src/app/api/users/[handle]/stats-notes/route.ts` — **owner-only, including reads** |
| POST | `/api/users/:handle/stats-notes` | `src/app/api/users/[handle]/stats-notes/route.ts` |
| DELETE | `/api/users/:handle/stats-notes/:id` | `src/app/api/users/[handle]/stats-notes/[id]/route.ts` |
| POST | `/api/chat/climbing-history` | `src/app/api/chat/climbing-history/route.ts` — streaming agent chat; own history only |
| POST | `/api/queues/session-image` | `src/app/api/queues/session-image/route.ts` — Vercel Queues consumer; private, never called by a browser |
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
| `stats_notes` | `GET/POST /api/users/[handle]/stats-notes`, `DELETE .../stats-notes/[id]` | `session.userId === handle` — **also on GET** |
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

## Background Jobs (Vercel Queues)

Work too slow for a request lives in a queue. Right now that is exactly one job — session header images (~35s) — but the seam is general.

| Piece | File |
|---|---|
| Producer + driver selection | `src/lib/server/imageQueue.ts` |
| The job body | `src/lib/server/sessionImageJob.ts` |
| Vercel push consumer | `src/app/api/queues/session-image/route.ts` |
| Topic trigger | `vercel.json` → `functions.experimentalTriggers` |

### Two drivers

| Driver | When | Behaviour |
|---|---|---|
| `memory` | local dev (default off-Vercel) | Runs the job in-process, detached from the request. **No `vercel link`, no OIDC token, no queue credentials** — `npm run dev` alone exercises the whole feature. |
| `vercel` | production (default when `process.env.VERCEL` is set) | `send()` to the `session-image` topic; Vercel invokes the push consumer. |

`IMAGE_QUEUE_DRIVER=memory|vercel` overrides the choice in either direction — set it to `vercel` locally (after `vercel link && vercel env pull`) to test the real thing.

Fire-and-forget is only safe in the `memory` driver: a local dev server keeps running after it responds, where a Vercel function can be frozen the instant it does. That asymmetry is the whole reason production needs a real queue rather than a detached promise.

Both drivers call the **same** `runSessionImageJob`, so a bug cannot hide in a code path that only production takes.

### Idempotency and deduplication

Nothing durable is written to mark a job as running, so there is no state that can strand a session in "generating" (see **Generate-once semantics**). Deduplication is therefore best-effort, in three layers:

1. **In-process** — `isGenerating()` short-circuits a refresh handled by the same instance.
2. **Cross-instance** — the automatic path publishes with `idempotencyKey: session-image:<id>:a<attempts>`. Two page views read the same attempt number, so they agree on the key and the queue collapses them into one job. A *later* attempt (after a recorded failure) derives a different key and is allowed through, so a dedupe key can never block a retry. A `DuplicateMessageError` is treated as success, not failure — it is the intended outcome of a refresh.

   > **Retention is part of this.** Vercel ties the dedupe window to the message's *lifetime*, so `retentionSeconds` is really two settings at once. It is set to **300s** rather than the 24h default: a job lost without recording a failure would leave `attempts` unchanged, so every later page view would recompute the same key and automatic generation would be deduped into silence for a day, recoverable only by the corner button. A five-minute window still collapses refreshes during a ~40s job (with room for the consumer's one retry) while letting the next visit try again.
3. **The job itself** — `runSessionImageJob` re-reads the session and the current row, skips when a banner already exists, and finishes with an upsert. Two jobs racing is a documented worst case, not a bug: both render, the later write wins, nothing is corrupted.

A deliberate press (`?regenerate=1`) publishes **without** a dedupe key — it should always run. The client keeps the button disabled until the job settles, which is what stops a mash from queuing five images.

### Sentry tracing

Both drivers emit the span pair from [Sentry's queues module conventions](https://docs.sentry.io/platforms/javascript/guides/nextjs/tracing/instrumentation/queues-module/):

| Span | `op` | Attributes |
|---|---|---|
| Producer | `queue.publish` | `messaging.destination.name`, `messaging.message.id`, `messaging.message.body.size`, `messaging.system` |
| Consumer | `queue.process` | the above plus `messaging.message.retry.count` (`deliveryCount - 1` — the first delivery is retry 0) and `messaging.message.receive.latency` (ms, from the broker's `createdAt` when available, else the payload's `enqueuedAt`) |

Trace context travels **in the payload** (`sentryTrace` / `baggage`) rather than in message headers, because the `metadata` the SDK hands a consumer does not expose headers. The consumer calls `Sentry.continueTrace()` so its transaction is a child of the `queue.publish` span — a job's trace hangs off the page view that asked for it instead of being an orphan. Each message also gets a fresh `withIsolationScope`, so tags and breadcrumbs don't leak between jobs on a warm instance.

`Sentry.flush(2000)` runs in the consumer's `finally`: a serverless instance can be frozen the moment the handler resolves, so spans have to be on the wire before then.

### Retries

Two independent budgets, deliberately:

- **Per message** — `MAX_DELIVERIES = 2` in the consumer's `retry` callback (retry after 10s, then acknowledge and give up). Kept low because each delivery is a paid image and `renderWithRetry` already retries the model call once inside a single delivery.
- **Per session** — `attempts` on the row, capped at `MAX_ATTEMPTS = 3`, bounding how many times *page loads* may queue new work for a session that keeps failing.

### Deployment notes

- **No environment variable is required in production.** The SDK authenticates via OIDC, which Vercel provides automatically on every deployment. Vercel Queues is in public beta on all plans, so nothing needs enabling in the dashboard, and topics are created implicitly on first publish — there is nothing to provision.
- The consumer must be declared in `vercel.json` or it is never invoked. That entry is also what makes it **private** — no public URL, only the queue infrastructure can call it.
- The `functions` key is a path glob relative to the project root, and **this project uses a `src/` directory**, so it must read `src/app/api/queues/…` rather than the `app/api/queues/…` shown in Vercel's docs. Get that wrong and the consumer is simply never invoked — jobs publish fine and nothing processes them.
- Topics are **partitioned by deployment ID**: in push mode a message is delivered back to the deployment that published it. Message-schema changes are therefore safe across a rollout — a new deployment only ever consumes its own messages, and the old one drains independently.
- `/api/queues/*` is exempt from rate limiting in `src/middleware.ts`. Callbacks arrive without a session cookie, so they would land in the shared anonymous IP bucket, and a 429 reads to the queue as a failed delivery and comes back as a retry.

---

## Stats Notes

A strip of small cards above the sends timeline on `/user/:handle/stats` — **one per chart column, aligned to it**. In week view there is a card per week; in day view a card per day. Clicking one opens the editor for *that* period, so the column you are looking at is the period you annotate and there is no separate date picker to fall out of sync with the chart.

Week notes and day notes are **distinct kinds**: a week note describes the whole week, a day note describes that day. The chart's granularity decides which kind you are editing.

| Piece | File |
|---|---|
| Vocabulary + zod schemas (shared) | `src/lib/statsNotes.ts` |
| List / create | `src/app/api/users/[handle]/stats-notes/route.ts` |
| Delete | `src/app/api/users/[handle]/stats-notes/[id]/route.ts` |
| Card strip, hover card, dialog | `src/components/StatsNotesRow.tsx` |

### ACL — the one read-protected resource

Everything else in allaboard is publicly viewable. These are not: a note can record how much someone drank last week, so **`GET` is owner-only exactly like the mutations**, and responses are `Cache-Control: no-store`. A resource that guards its writes and leaks its reads would be the failure mode that looks like it followed house style. 401 unauthenticated, 403 for anyone but the owner, on every method.

### Scope, and what is editable where

| View | A card per | Hover shows | Dialog edits |
|---|---|---|---|
| Week | week column | that week's own notes **and** the daily notes inside it, in two labelled sections | that week's notes only |
| Day | day column | that day's notes | that day's notes only |

A week note is not shown on any day card — it belongs to no single day, and switching to Week is how you see it. A day note *is* shown on its week's card, faintly when the week has no notes of its own, so a week card hints at what is inside it.

The week view *displays* daily notes so they can be seen in context but must not delete them — a delete button beside a note you are not in a position to edit is an accident waiting to happen. `DELETE` therefore takes a `scope` query parameter naming the view it was made from and returns **409** when it disagrees with the note's own scope, so the rule survives a hand-rolled request rather than living only in the UI.

### Aligning to the columns

Geometry comes from the chart, not from CSS: `chart.convertToPixel({ xAxisIndex: 0 }, i)` gives each category's centre pixel and the gap between adjacent centres gives the width. ECharts owns the grid margins and the category spacing, so a second implementation of that arithmetic in CSS would drift the moment either changed. It is recomputed in the `onReady` callback, which `EChart` fires on init, **on every resize, and on every option change** — the same hook `drawSundayLines` already used, so the two stay consistent by construction. Until the chart has laid out there is no geometry and no cards are drawn: a card over the wrong column is worse than one not yet there.

The dialog ends with a **Done** button, not only an ✕. Each note is stored the moment "Add note" is pressed, but a close box alone gave no sign of that — closing a dialog normally means discarding — so the footer states that notes are saved as they are added. If the add form holds a half-filled note, that line changes to say it is *not* saved yet: Done deliberately does not store a draft, which is fine, but only if it is said out loud rather than silently dropping typed input.

A week note is always filed against its **Monday**, and a database `CHECK` on `EXTRACT(ISODOW)` enforces it, so one week has exactly one key and cannot be written twice under two member days.

> **The day view is dense.** The default range is 6 months — about **182 day columns** — so a day card is only a few pixels wide, and the strip reads like Google Calendar's all-day row rather than a row of labelled cards. The strip is kept 24px tall so a 4px-wide card is still an easy target, the note count is lettered only where a column is wide enough (week view), and the hover card always names the period so there is no doubt which day is under the cursor.

### Categories

Each category brings its own inputs. The three session categories describe something that happened on a *day*; diet and sleep are the two with genuinely different daily and weekly readings, and their option lists differ per scope.

| Category | Scopes | Data |
|---|---|---|
| Outdoor Climbing Session | day | hardest route worked / sent (**YDS**), pitch count |
| Outdoor Bouldering Session | day | hardest boulder worked / sent (V-scale) |
| Strength Session | day | lifts (Deadlift, Squat, Overhead Press, Bench Press, Curl) each with max weight; exercises (Pull-up **with optional added weight**, Bent-arm hang, Push-up) |
| Dietary Notes | day, week | scope-specific flags + a drinks counter (`Drinks today` / `Drinks this week`) |
| Sleep Notes | day, week | scope-specific flags |

Every grade field is optional, **including on the bouldering session**. The spec marks the route grades optional and leaves the boulder ones bare, but requiring "hardest boulder sent" would make it impossible to log a session where nothing went down — the exact case the route category explicitly allows for. A session with no grades still carries its main claim: the climber was out that day.

### Why the vocabulary is shared, and jsonb

`src/lib/statsNotes.ts` is client-safe and holds the option lists, the zod schemas *and* the one-line summariser. The dialog builds a note from it and the route handler validates against it, so a dropdown can never offer an option the server rejects. Both scope rules are enforced there: the flag lists per scope, **and which categories exist at which scope** — a client-side list is not validation, which a test caught after the server initially accepted an outdoor bouldering session filed against a whole week.

`data` is `jsonb` rather than a wide table of nullable columns: the five categories have genuinely different shapes (two grades and a count; two variable-length lists; flags plus a counter), a note is always read whole for one period to render a card, and the alternative is five tables or a dozen mostly-null columns. Schemaless in the column, validated at the boundary. It is *source* data, not a derived aggregate, so the denormalization policy does not apply.

The chip is loaded with `next/dynamic` — it is owner-only, so a visitor should never download the dialog and its option tables.

---

## Import Mountain Project Ticks

An upload on your own profile page (`Import Data` → *Upload Mountain Project Ticks*) that turns a Mountain Project CSV export into outdoor **day notes**.

| Piece | File |
|---|---|
| Parser + grouping rules (pure) | `src/lib/server/importMountainProject.ts` |
| Endpoint | `src/app/api/users/[handle]/import/mountain-project/route.ts` |
| UI | `ImportSection` in `src/app/user/[handle]/page.tsx` |

**They do not become climbs.** A Mountain Project tick is outdoor rock — no board, no angle — so adding them to the climbs directory everyone browses would pollute it. They land as private day notes: outside context for how someone's climbing is going, which is what notes are for. Owner-only, like the notes themselves.

One day becomes at most two notes — an Outdoor Climbing Session for that day's roped climbs, an Outdoor Bouldering Session for its boulders. Per note: **pitches** summed across that day's rows (routes and boulders counted separately, since they are separate notes), the **hardest sent**, and the **hardest worked**. A missing send is left blank rather than guessed at.

### Reading the export

Rules derived from a real 724-row export and pinned by a stub fixture in `src/__tests__/lib/importMountainProject.test.ts` that reproduces every awkward shape it contained:

- **Columns are resolved by header name, not position.** The spec for this feature placed Lead Style at column 9; the real file has `Your Stars` there and Lead Style at 11. Reading by name makes a reordered or extended export a non-event instead of a silent mis-import.
- **`Rating Code` decides "hardest".** It is Mountain Project's own numeric ordering and is monotonic with difficulty, interleaving slash grades correctly (`5.10a/b` = 2800 between 5.10a = 2600 and 5.10b = 2900). Comparing grade *strings* would need a parser that already handles every messy variant.
- **Boulders record success in `Style`; routed climbs in `Lead Style`** — which is always blank on a boulder row.
- **Four lead styles mean "I climbed it", not one.** The spec named only `Redpoint`, but `Onsight`, `Flash` and `Pinkpoint` are ascents too — an onsight is a *harder* one. In the reference export they are 56 rows across 43 days that would otherwise have reported no send at all. `Fell/Hung` is the one status meaning worked-but-not-sent.
- **An unrecognised status still records a session.** A top-roped or unlabelled day was a day out; it just claims no grade.
- **Grades resolve downward**, so an import never overstates: a slash grade takes its lower half (`5.12b/c` → `5.12b`), `+` lands mid-band (`5.10+` → `5.10c`, matching its code of 3300), `-` at the bottom (`5.14-` → `5.14a`), protection suffixes are stripped (`V7 PG13` → `V7`), and V-scale modifiers drop to the base grade since there is no `V6+` to store. A test asserts nothing is dropped, so a new grade shape shows up as a failure rather than as silent data loss.

> **The fixture is a stub, not a captured export**, so it cannot notice Mountain Project changing their format. If an import ever starts dropping rows, compare a fresh export's header row against `EXPORT_HEADER` in that test file first.
- Quoted fields are parsed properly — `Notes` and `Location` both contain commas, and a naive `split(",")` shifts every later column.

### Re-importing

**Non-destructive and idempotent.** A day already carrying a note of the category being imported is skipped, so running the same export twice adds nothing and a note written by hand is never clobbered. Verified live against a 724-row export: the first import created 261 notes, the second created 0 and skipped 261. Every planned note is validated against the same `noteSchema("day")` the dialog uses, so an import can never write a note the editor would refuse to display.

---

## Discuss Your Climbing History

An agentic chat at the foot of `/user/:handle/stats`, where a climber can interrogate their own logbook: trajectory and a realistic next grade, day-of-week form, hardest send this year, cycles in their training.

| Piece | File |
|---|---|
| Tools (the only source of truth) | `src/lib/server/climbingHistoryTools.ts` |
| Streaming endpoint | `src/app/api/chat/climbing-history/route.ts` |
| Chat UI | `src/components/ClimbingHistoryChat.tsx` |

### ACL — own history only

Available **only to an authenticated climber on their own stats page**. Two independent gates:

- The page renders the chat only when `user.id === handle`.
- The endpoint builds its tools from `resolveUserId(req)`, so **no tool takes a user id**. There is no "whose history" parameter to tamper with, which makes prompt injection structurally unable to reach another climber's data rather than merely discouraged from it. A test asserts no tool schema contains a user/handle/climber field.

### Grounding

The agent starts with **no data in its prompt** — it must call tools to learn anything, which is what stops it inventing climbs:

| Tool | Returns |
|---|---|
| `historySummary` | Whole-logbook shape: first/last tick, totals, sends by grade, boards. Cheap; the sensible first call |
| `listTicks` | Real ticks in a date range — climb, grade, board, angle, sent, attempts, rating, notes, **`boardDifficulty`** and **`adjustedPoints`** |
| `listSessions` | Real sessions — date, day of week, counts, hardest grade sent, minutes |
| `gradeProgression` | Month-by-month hardest grade, **best board-adjusted send**, adjusted point total, sends, days climbing |
| `boardDifficulty` | Every board the climber uses with its multiplier, plus the scale, formula and a worked example |
| `listNotes` | The climber's own day/week notes in a range — outdoor sessions, strength, diet, sleep — each with a readable summary *and* its raw fields |
| `notesSummary` | Month-by-month rollup of notes: outdoor days, pitches, hardest outdoor grades, strength days, drinks logged, sleep reports |

Supporting decisions:

- **`stopWhen: stepCountIs(8)`** gives the agent room to orient, pull ticks, pull sessions, then answer. A tools-only agent with one step answers from nothing, which is precisely how confident nonsense is produced.
- **Wide ranges are instructed.** A year of ticks is a corpus; last week's is an anecdote.
- **Truncation is surfaced.** A range over `MAX_ROWS` (400) comes back with `truncated: true` and a note to narrow it, so the model never treats a partial set as the whole record.
- **Dates are formatted in Postgres** (`to_char`), not sliced off a UTC ISO string. `tick_sessions.date` is a real `date` column, and a client-side UTC slice landed a day either side of it — the agent quotes these dates back to the climber, so two tools disagreeing about which day a climb happened is a real bug, observed and fixed.
- Speculation about future grades is explicitly *welcome*, on two conditions: anchored in figures it actually pulled, and labelled as projection rather than record.

### Notes are half the picture

The agent reads the climber's own [Stats Notes](#stats-notes) as well as their ticks, because a logbook of board climbs cannot explain itself:

- **A quiet training month is not automatically detraining.** Outdoor sessions and pitch counts live in the notes, not in the tick data, so the prompt requires checking them before calling a dip a plateau. Verified: asked "my board training looks thin — am I losing fitness?", the agent called `notesSummary` and answered *"No — your board log is thin because there's barely any board history yet… meanwhile you've been consistently outside on rock"*, with a monthly table of outdoor days and pitches.
- **Outdoor grades are a different scale.** Routes are YDS, boulders are V-scale, and neither belongs in the board's adjusted-points arithmetic. Both note tools say so in a `legend` field.
- **Cycles usually live in the notes** — sleep reports, drink counts and strength days are what turn "your form dips every third week" from a hunch into an observation.
- **Correlation is not cause, and the sample is usually small.** The prompt requires labelling which it is. Verified: with one sleep note on record the agent said *"One data point can't establish a pattern; it's a coincidence worth watching, not a finding"* rather than claiming a link.
- Daily and weekly drink counts are reported **separately**, never summed — a climber who logs both would otherwise be double-counted, and a wrong total is worse than two honest ones.

Both tools are bound to the session's climber like every other one, which matters more here: notes are the only read-protected resource in the app.

### Board difficulty is part of every comparison

A V8 is not a V8. `boards.relative_difficulty` runs **1.00 (easiest) to 2.00 (hardest)**, fitted by per-user logistic regression on real per-attempt send rates controlling for grade (`src/lib/server/boardDifficulty.ts`). Live values put **Moonboard 2016 at 2.00** against **Kilter Board (Original) at 1.00**.

The tools therefore hand the agent a weighted score, not just a grade:

```
adjustedPoints = ROUND(gradePoints × relative_difficulty)      // +20% when flashed
gradePoints    = ROUND(10 × 1.3^gradeIndex)                    // grade_base_points()
```

> **V8 on a 2.00 board = 82 × 2.00 = 164, which beats V10 on a 1.00 board = 138.** Several V8s on a hard board really can outweigh a V9 or V10 on an easy one, and the agent is instructed to say so when the data shows it.

Three decisions worth keeping:

- **One formula, not two.** `ADJUSTED_POINTS_SQL` in `climbingHistoryTools.ts` is the *same* expression the points trigger uses, reusing the `grade_base_points()` SQL helper. Inventing a parallel scale for the agent would let its arithmetic drift from the leaderboard's, and two authorities on "how hard was that" is worse than none.
- **Trajectory is judged on adjusted figures.** A climber who switches to a harder board sees their raw grades fall while genuinely getting stronger; reading that as a plateau is flatly wrong. `gradeProgression` reports `hardestGradeSent` and `bestAdjustedSend` side by side precisely because when they disagree, the disagreement is the interesting fact.
- **Projections must name a board.** "A realistic V10" is meaningless on its own; the prompt requires the board, and requires the arithmetic to be shown whenever a reweighting is relied on — a silent reweighting reads as the model making things up.

Verified against a seeded V8-on-Moonboard / V10-on-Kilter pair: the agent called `boardDifficulty`, flipped the ranking, printed `82 × 2.00 = 164` beside `138 × 1.00 = 138`, and expressed its projection as "V9 on the Kilter Board".

### Model

Default **`anthropic/claude-sonnet-5`** (override with `AI_CHAT_MODEL`).

> **Why not GPT-4o?** It is two generations old for agentic tool use and, on this gateway, *more expensive per input token* than both this model and `openai/gpt-5` — so it loses on price and recency simultaneously. `openai/gpt-5.4` is the drop-in if OpenAI is preferred. Sonnet 5 is also already the art-direction model, so the app keeps one language-model vendor.

### Telemetry

Instrumented for Sentry's AI Agents and Conversations views:

- Each tool call opens a **`gen_ai.execute_tool`** span named `execute_tool <name>`, with `gen_ai.operation.name`, `gen_ai.tool.name`, `gen_ai.tool.type` and the serialized input. The AI SDK's own `ai.toolCall` spans do not carry the `gen_ai.*` convention Sentry's module keys off, so without these the calls appear as anonymous work.
- `experimental_telemetry` sets `isEnabled`, `functionId: "climbing-history-chat"`, `recordInputs`/`recordOutputs`, and `metadata` carrying `gen_ai.conversation.id`, `gen_ai.agent.name` and `user.handle`.
- **`Sentry.setConversationId()`** is called per turn so multi-turn chats group into one thread under **Explore → Conversations**. The client mints one id per mounted chat (`useId`, not a timestamp — pure, and stable across the re-renders that streaming causes).
- `sentry.server.config.ts` enables `vercelAIIntegration({ recordInputs: true, recordOutputs: true })`. Node enables the integration by default but records neither prompts nor completions unless asked; here the conversation is the climber's own logbook read back to them, and the Conversations view is only useful if it can show what was said.

A verified trace looks like: `ai.streamText` → 3× `ai.streamText.doStream` (the agentic loop) → 3× `ai.toolCall` → 3× `gen_ai.execute_tool`.

### Why not AI Elements

AI Elements is a shadcn/ui generator, and this project has no shadcn, no Radix and no `cva`. Adopting it would install a second design system beside the hand-rolled Tailwind one and leave the chat looking foreign on its own page. The AI SDK (`useChat`) does the real work; presentation is hand-rolled to match the stone/orange theme. **`streamdown`** — the streaming-markdown renderer AI Elements itself uses — is kept, because rendering tables well is a stated requirement and streaming markdown is genuinely fiddly. It needs `@source "../../node_modules/streamdown/dist/*.js"` in `globals.css` so Tailwind scans its utilities, and `.prose-chat` styles it for the dark theme.

The chat is loaded with `next/dynamic` (`ssr: false`): it pulls a markdown renderer and its dependency tree, which is a lot of JavaScript for a feature only the page's owner can use.

---

## Session Header Images

Each climbing session permalink (`/user/:handle/sessions/:id`) carries a 1200×400 AI-generated banner: a visual read of what that session *felt* like, drawn from the climbs the climber logged and the notes they wrote.

### Pipeline

Two model calls through the **Vercel AI Gateway** (`AI_GATEWAY_API_KEY`), both in `src/lib/server/sessionImage.ts`. The whole pipeline runs in a **background job**, never in the request that asked for it — see **Background Jobs** above:

1. **Art direction** (`AI_PROMPT_MODEL`, default `anthropic/claude-sonnet-5`) — reads the session brief and writes a single image prompt. Three constraints live in the system prompt so nothing in the notes can dilute them: the **notes outrank the climb names** (a name may suggest a motif, but the notes decide the mood); **at least three specifics of the session** (a note's image, a name's motif, a grade, an attempt count, hours spent) must be woven into **one coherent scene** rather than a collage, so the banner is recognisably *this* session; and the image must contain **no text of any kind**.

   The house style is a legible, **well-lit** bouldering gym — chalked plastic holds and volumes on an overhanging wall, mats, tape, clerestory daylight — drawn as **cel-shaded anime** in the cinematic register of Ghost in the Shell but brighter, warmer and more colourful. The **holds carry the colour**: bold primary reds, blues, yellows and greens the way a real gym looks, over warm stone and pale concrete, with an ember-orange accent for warmth and shadows kept open rather than crushed to black. Generous negative space, and one quiet deadpan visual joke.

   The three-details rule has teeth only if the details are **concrete and nameable** — a specific object, gesture, posture or feature of the wall, not "the mood of a hard session". The brief therefore carries everything the tick knows, not just the climb name and the note: the climb's **description**, its **board and angle**, the climber's **star rating** and their own **grade opinion**, and the **minutes spent**. Many sessions carry no notes at all, and a bare name and grade cannot supply three details — those fields are what stop a note-less session falling back on generic climbing imagery.
2. **Render** (`AI_IMAGE_MODEL`, default `openai/gpt-image-2`) — renders that prompt at `AI_IMAGE_RENDER_SIZE` (default `1536x1024`, ~23s).
3. **Crop** (`cropToBanner`, sharp) — scales that render to cover 1200×400 and takes the centre, re-encoding to JPEG q86. This is what guarantees the shape contract; the page reserves a 3:1 box before the image loads, so a differently-shaped asset would be a layout bug.

> **Why a render-then-crop step?** The GPT image models only emit a fixed set of near-square sizes (1024×1024 / 1536×1024 / 1024×1536), so the widest landscape one is rendered and cut down. Cropping 3:2 → 3:1 costs the top and bottom quarters of the frame, which is why the art direction tells the prompt model to keep the subject in the central band and leave the margins deliberately empty. The step also normalises everything else: any model, any output size, one 1200×400 JPEG (~40 KB, down from ~200–250 KB when the model rendered 3:1 directly).
>
> The crop **never fails the pipeline**. It runs after an image has been paid for, and an uncropped render still displays correctly — the page uses `object-cover` in an `aspect-[3/1]` box, so the browser makes the same centre cut. A sharp failure is logged as a warning and the raw render is stored instead.
>
> `AI_IMAGE_RENDER_SIZE` exists because the right value is model-specific: a model that renders 3:1 natively (e.g. `bfl/flux-2-max`, the previous default) wants `1200x400` here, which turns the crop into a no-op re-encode rather than a cut.

### Generate-once semantics

**Nothing is written to the database until an image exists.** This is the rule that keeps a session from getting stuck: every row in `session_images` describes a *finished* outcome — `ready` with bytes, or `failed` with a reason — so a job that dies leaves no trace at all and the next visit queues cleanly.

> **Why:** `POST` used to claim its job by inserting a `pending` row *before* generating. That is durable state describing a running process, so when the process died the row stayed `pending` forever and the session showed "generating" with nothing behind it. A reclaim path existed (a `pending` row older than five minutes could be taken over) but was unreachable from the UI, because the client only ever *polled* on `pending` and never POSTed. Same shape as the original unreachable `failed` retry.
>
> A `pending` row can still be *read* — one left behind by that scheme — and is treated exactly like a failure: retryable, against the same budget. Nothing writes that state any more.

Because no row marks work as in progress, `GET` reports `none` for the ~35s a job is running. The client treats that as "still working" rather than "missing" while it is waiting on a job it queued. Deduplication happens at the queue instead — see **Background Jobs** above.

A **successful** banner is generated once and never regenerated on its own, even after new climbs are logged into that session. The single exception is a deliberate press of the **regenerate** button in the banner's bottom-right corner (signed-in viewers only, `POST ?regenerate=1`). The old bytes stay in `data` until the new ones overwrite them, so a failed regeneration destroys nothing.

Because the raw bytes are served `immutable`, the status `url` carries a `?v=<updated_at epoch ms>` stamp. Without it a regenerated banner would keep showing the previous picture out of cache — for the person who pressed the button, and for everyone who had already loaded the page.

### Failure and retry

Image generation fails transiently — a malformed gateway response, an upstream 5xx. Recovery is bounded at three levels:

1. **In-request** — `renderWithRetry` retries the image call once. The AI SDK retries its own retryable errors but treats a malformed response body as terminal, which is the failure seen in practice ("Invalid JSON response" after a full ~22s render). Worst case ~50s, inside the route's 60s budget.
2. **Across visits** — a `failed` row (or a stranded `pending` one) is retried on the next page view while `attempts < MAX_ATTEMPTS` (3). The server reports this as `canRetry` so the retry budget lives in one place. The client POSTs on `pending` as well as `none` and `failed`, which is what recovers a stranded session; that costs nothing when a generation really is running, because the in-flight guard answers `pending` without starting a second one.
3. **Manual** — the corner button. Over a finished banner it asks for a different picture; over one that never arrived it asks again. Either way it POSTs `?regenerate=1`, which takes over a row in **any** state and is **not** capped by the attempt budget — a click is a deliberate act, where the budget exists to bound the automatic page-load retries. The owner additionally has `?retry=1` (owner-only) behind the "Couldn't picture this session · Try again" line, which resets `attempts`.

The client shows the placeholder while a generation is in flight and polls for up to `MAX_POLLS × POLL_MS` (~2 minutes). If that runs out with still no image it marks the banner **stalled**: the sweep animation stops, the caption becomes "No image yet.", and the corner button appears for signed-in viewers. An animation still running after the work has plainly stopped is a lie the button would have to argue with.

> **Why bother:** the original design had no way back from `failed` — the client only POSTed when status was `none`, so a single transient flake left the session permanently blank with no feedback. The server's reclaim path existed but was unreachable. The same was true of a stranded `pending` row, which is what the no-write-until-complete rule above removes.

Failures are stored via `describeError`, which flattens the AI SDK's status code, response body, and nested cause into one searchable line — bare `err.message` yields uninformative strings like "Invalid JSON response". The same failures go to Sentry tagged `feature: session_image`.

### What gets logged

One record per step, because the job runs where nobody is watching and the interesting failure is a stall rather than an exception. Searchable in Sentry by `session.id`.

| Message | Level | Emitted | Key attributes |
|---|---|---|---|
| `Session image job enqueued` | info | producer, on `POST` | `queue.driver`, `messaging.message.id`, `messaging.message.deduped`, `image.attempts` |
| `Session image job received` | info | consumer, first thing | `messaging.message.retry.count`, `messaging.message.receive.latency`, `image.requested_by` |
| `Session image job generating` | info | after the ticks load, before the model calls | `job.stage`, `job.elapsed_ms`, `tick_count` |
| `Session banner art direction written` | info | between the two model calls | `ai.prompt_model`, `ai.prompt_ms`, `ai.prompt_chars` |
| `Session banner render failed, retrying` | warn | a render attempt failed | `ai.attempt`, `ai.render_ms`, `error.message` |
| `Session banner generated` | info | pipeline complete | `ai.prompt_ms`, `ai.render_ms`, `image.crop_ms`, `ai.total_ms`, `ai.image_prompt` |
| `Session image stored` | info | bytes written | `owner`, `image.bytes`, `image.regenerated` |
| `Session image job skipped` | info | nothing to do | `reason` = `gone` \| `already` \| `no_climbs` |
| `Session image job failed` | error | the job threw | **`job.stage`**, `job.elapsed_ms`, `error.message` |
| `Session image job threw` | error | the delivery failed | `job.duration_ms`, `messaging.message.retry.count` |
| `Session image job finished` | info | delivery succeeded | `job.outcome`, `job.duration_ms` |
| `Session image job abandoned` | warn | retry budget spent | `messaging.message.retry.count` |

Two details that carry most of the diagnostic weight:

- **`Session image job received` is flushed immediately** (`Sentry.flush`), not left in the buffer. If the function is later killed — a 60s timeout, a freeze — nothing else from that invocation reaches Sentry, and "never delivered" versus "delivered, then stalled" is exactly the distinction the buffer would have swallowed. It is the one log worth paying a round trip for.
- **`job.stage`** names the step in flight when a job threw: `load_session`, `load_ticks`, `generate`, `store`. An exception message rarely identifies the step on its own — "Invalid JSON response" fits either model call. The stage is deliberately *not* advanced while recording a failure, so a generation failure never reads as a failure to record one.

**Reading a stall.** The last message tells you where it stopped:

| Last log seen | What it means |
|---|---|
| `enqueued`, nothing after | never delivered — check the `vercel.json` trigger path and the consumer's invocations |
| `received`, nothing after | delivered, died before finishing — almost always the function's duration ceiling |
| `art direction written`, nothing after | the image model is where it hangs (the longest single step) |
| `render failed, retrying` then nothing | the retry pushed the job past its budget; see `ai.render_ms` |

### Timing budgets

Four numbers govern how long a job may take and when it is retried. They interlock, so changing one usually means changing another.

| Setting | Value | Where | Governs |
|---|---|---|---|
| `maxDuration` | **300s** (5 min) | `export` in the consumer route | Hard termination of one delivery |
| `visibilityTimeoutSeconds` | **180s** (3 min) | `handleCallback` options | Lease length — how long after a worker *stops extending* before the message is handed to someone else |
| `retentionSeconds` | **900s** (15 min) | `send()` in `imageQueue.ts` | Message TTL, and the dedupe window |
| `retry → afterSeconds` | **10s** | `handleCallback` retry callback | Backoff after an *explicit* failure |

Against a measured **~41s** pipeline (+ ~25s if the render retries), 300s is generous headroom. It is also both the default *and* the maximum on every plan including Hobby, now that fluid compute is on by default — so 5 minutes is as long as a delivery can run without moving to Pro (800s) or the extended-duration beta (1800s).

**Why the visibility timeout is shorter than `maxDuration`.** The SDK re-extends the lease while the handler is alive, so a healthy job is never interrupted by it. What 180s really sets is how long the queue waits after a worker *stops* extending — crashed, frozen, terminated — before redelivering. Shorter than the termination limit means a dead worker's message comes back in three minutes rather than five. The cost: if auto-extension ever lapses on a still-running job, the message can be redelivered alongside the first delivery. That is wasted inference, not corruption, because `runSessionImageJob` is idempotent.

**Why retention has to be the largest.** A message is deleted the moment its TTL expires, *whatever state it is in*. So the TTL has to cover the whole retry sequence — `300s (delivery 1) + 180s (lease wait) + 300s (delivery 2) = 780s` — or the delivery budget quietly collapses to a single attempt. 900s covers it with room for queue latency.

> A long retention does **not** widen the deduplication hole, despite tying the dedupe window to the message lifetime. The key is held only while the original message is alive, and a live message is one that is still going to be delivered — so being deduplicated against it is the correct outcome. Once the message is acknowledged or expires, the key frees with it.

`ai.prompt_ms`, `ai.render_ms` and `ai.total_ms` are the numbers to watch against these budgets.


### ACL

- **Trigger generation** (`POST`): any authenticated user, for any session — a session earns its banner on the first visit by anyone signed in, not only its owner. Sign-in is still required because each call costs real inference and should be attributable to an account.
- **Regenerate** (`POST ?regenerate=1`): any authenticated user. The only way past the generate-once rule, and the button behind both jobs — a different picture for a finished banner, another attempt for one that never arrived. It takes over a row in **any** state (`ready`, `failed`, or a stranded `pending`), resets `attempts`, and overwrites `data` when the new render lands. Not capped by the attempt budget: a press is deliberate, where the budget bounds the automatic page-load retries. Still deduplicated by the in-flight guard, so two people pressing at once produce one image (within one instance).
- **Manual retry** (`POST ?retry=1`): the session owner only. The `attempts` cap is what stops a session that keeps failing from being retried by everyone who opens it, so only the owner may reset it; for anyone else the flag is ignored (treated as an ordinary POST). The "Try again" affordance is likewise rendered for the owner only.
- **View** (`GET` status and `GET .../raw`): public, like the session itself. A signed-out visitor never triggers generation and renders nothing where a banner has yet to be made.
- **Row ownership**: `session_images.user_id` is always the session's climber, never the visitor who triggered generation — that column is what CASCADE-deletes the banner with its account, so it has to follow the session.

### Frontend

`src/components/SessionHeaderImage.tsx` owns the whole lifecycle. Generation takes ~20–30s inline, so the component shows a placeholder sized exactly like the finished banner (no layout shift): a dim stone gradient with a slow `animate-banner-sweep` warm sweep, defined in `globals.css` and disabled under `prefers-reduced-motion`. The image fades in on `load`.

The component POSTs when status is `none`, **or** when it is `failed` and the server still reports `canRetry` — that second case is what makes a transient failure heal itself on the next visit. A signed-out visitor never triggers generation and never sees a failure state; a missing banner simply renders nothing rather than an empty 400px frame.

A signed-in viewer also gets a small button in the banner's bottom-right corner. One control, two jobs: over a finished banner it asks for a different picture, and over a **stalled** one (polling ran out with no image) it asks again — same press, same position, only the label changes. It is styled to stay out of the way, since it spends inference and may overwrite a picture the climber likes.

When replacing a finished banner the current one **stays on screen** for the ~25s the call takes, since it is still the session's banner until a replacement actually arrives (and still is, if the render fails). The `<img>` is keyed on the versioned URL so the new bytes remount the element and re-fire `load`, giving the replacement the same fade-in as the original.

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
| `AI_IMAGE_MODEL` | optional | Overrides the image model (default `openai/gpt-image-2`) |
| `AI_IMAGE_RENDER_SIZE` | optional | Size requested from the image model before cropping to 1200×400 (default `1536x1024`) |
| `AI_CHAT_MODEL` | optional | Overrides the climbing-history chat model (default `anthropic/claude-sonnet-5`) |
| `IMAGE_QUEUE_DRIVER` | optional | `memory` or `vercel`. Overrides the background-job driver; defaults to `vercel` on Vercel and `memory` everywhere else. **Nothing needs setting in production** — the queue SDK authenticates via OIDC automatically |

`SESSION_SECRET` must also be added to Vercel Project → Settings → Environment Variables.
