# Allaboard — Claude Code Instructions

## Project Overview

Allaboard is a climbing community platform for logging sessions, sharing climbs, and tracking stats. It's a Next.js frontend backed by an Express.js API and PostgreSQL database.

**Hardcoded current user:** `alex_sends` (no auth system yet — MVP placeholder throughout the codebase)

---

## Architecture

```
/
├── src/                    # Next.js frontend (App Router)
│   ├── app/                # Pages
│   ├── components/         # Shared UI components
│   └── lib/
│       ├── types.ts        # Shared TypeScript interfaces
│       ├── utils.ts        # timeAgo(), GRADE_COLORS, ALL_GRADES
│       └── db/
│           ├── index.ts    # Re-exports from ./remote
│           └── remote.ts   # All API calls (data access layer)
└── api/                    # Express.js backend
    ├── src/
    │   ├── index.ts        # App setup, all routes registered
    │   ├── db.ts           # Knex DB init
    │   ├── stats.ts        # Stats computation logic
    │   └── routes/         # Route handlers
    ├── migrations/         # Knex migrations (PostgreSQL)
    └── seeds/              # Seed data
```

---

## Development

### Start everything (frontend + API)
```bash
npm run dev
```
Runs Next.js (port 3000) and Express API (port 3001) concurrently via `concurrently`.

### Frontend only
```bash
npx next dev
```

### API only
```bash
npm run dev --prefix api
```

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
4. `20260314000004_create_sessions` — sessions table
5. `20260314000005_create_log_entries` — log_entries table

---

## Database Schema

### `users`
| Column | Type | Notes |
|--------|------|-------|
| id | text | primary key (handle-based) |
| handle | text | unique |
| display_name | text | |
| avatar_color | text | Tailwind color class |
| bio | text | |
| home_board | text | Kilter / Moonboard |
| home_board_angle | integer | |
| joined_at | timestamp | |
| followers_count | integer | |
| following_count | integer | |
| personal_best_kilter | text | grade string |
| personal_best_moonboard | text | grade string |

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

## API Endpoints (`localhost:3001`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/climbs` | List all climbs (newest first) |
| GET | `/climbs/:id` | Climb detail with beta_videos |
| POST | `/climbs` | Create climb |
| GET | `/users` | List all users |
| GET | `/users/:handle` | User by handle |
| PATCH | `/users/:handle` | Update user profile |
| GET | `/sessions?userId=<handle>` | Sessions (optionally filtered) |
| POST | `/sessions` | Create session |
| POST | `/log-entries` | Log a climb (auto-creates session, increments sends) |
| GET | `/feed?userId=<handle>` | Activity feed (excludes self) |
| GET | `/stats/:userId` | User stats (grade pyramid, frequency, progress) |

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

## Adding New Features — Common Patterns

### Add a new API endpoint
1. Create or edit a route file in `api/src/routes/`
2. Register it in `api/src/index.ts`
3. Add the fetch call in `src/lib/db/remote.ts`
4. Add the TypeScript type in `src/lib/types.ts` if needed

### Add a new database table
1. Create migration: `cd api && npx tsx knexfile.ts migrate:make <name>`
2. Write the migration in `api/migrations/<timestamp>_<name>.ts`
3. Run it: `npm run migrate --prefix api`
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

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | local postgres | Full postgres connection string |
| `PGUSER` | `$USER` | Postgres user for local dev |
| `PORT` | `3001` | API server port |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | API base URL for frontend |
