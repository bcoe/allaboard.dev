/**
 * localStorage implementation of the data layer.
 *
 * To migrate to Postgres, replace this file (or add a `postgres.ts` sibling)
 * and update `src/lib/db/index.ts` to re-export from it instead.
 * All callers import from `@/lib/db` and are unaffected.
 */

import {
  Climb,
  User,
  Session,
  LogEntry,
  ClimberStats,
  FeedActivity,
  Grade,
} from "@/lib/types";
import {
  mockClimbs,
  mockUsers,
  mockSessions,
  mockFeedActivities,
} from "@/lib/mock-data";
import { ALL_GRADES } from "@/lib/utils";

// ─── Storage keys ─────────────────────────────────────────────────────────────

const K = {
  climbs:   "ab:climbs",
  users:    "ab:users",
  sessions: "ab:sessions",
  feed:     "ab:feed",
  seeded:   "ab:seeded",
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function read<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

// ─── Seeding ──────────────────────────────────────────────────────────────────

/**
 * Populate localStorage with mock data on first visit.
 * Call this once at the top of every client component via useEffect.
 */
export function initStorage(): void {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(K.seeded)) return;

  write(K.climbs,   mockClimbs);
  write(K.users,    mockUsers);
  write(K.sessions, mockSessions);
  write(K.feed,     mockFeedActivities);
  localStorage.setItem(K.seeded, "1");
}

/** Wipe all app data and re-seed from mock data. */
export function resetStorage(): void {
  if (typeof window === "undefined") return;
  Object.values(K).forEach((k) => localStorage.removeItem(k));
  initStorage();
}

// ─── Current user ─────────────────────────────────────────────────────────────

const CURRENT_USER_ID = "alex_sends";

export function getCurrentUser(): User {
  const users = read<User[]>(K.users) ?? mockUsers;
  return users.find((u) => u.id === CURRENT_USER_ID)!;
}

// ─── Climbs ───────────────────────────────────────────────────────────────────

export function getClimbs(): Climb[] {
  return read<Climb[]>(K.climbs) ?? [];
}

export function getClimbById(id: string): Climb | undefined {
  return getClimbs().find((c) => c.id === id);
}

export function createClimb(
  data: Omit<Climb, "id" | "createdAt" | "author">
): Climb {
  const climbs = getClimbs();
  const climb: Climb = {
    ...data,
    id: crypto.randomUUID(),
    author: CURRENT_USER_ID,
    createdAt: new Date().toISOString(),
  };
  write(K.climbs, [...climbs, climb]);
  return climb;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export function getUsers(): User[] {
  return read<User[]>(K.users) ?? [];
}

export function getUserById(id: string): User | undefined {
  return getUsers().find((u) => u.id === id);
}

export function updateCurrentUser(patch: Partial<Omit<User, "id">>): User {
  const users = getUsers();
  const updated = users.map((u) =>
    u.id === CURRENT_USER_ID ? { ...u, ...patch } : u
  );
  write(K.users, updated);
  return updated.find((u) => u.id === CURRENT_USER_ID)!;
}

// ─── Sessions & Log Entries ───────────────────────────────────────────────────

export function getSessions(userId?: string): Session[] {
  const all = read<Session[]>(K.sessions) ?? [];
  return userId ? all.filter((s) => s.userId === userId) : all;
}

/**
 * Log a climb attempt. Finds (or creates) a session for today, appends a
 * LogEntry, and prepends a FeedActivity so it shows in the feed.
 */
export function logClimb({
  climbId,
  date,
  attempts,
  sent,
  notes,
}: {
  climbId: string;
  date: string;
  attempts: number;
  sent: boolean;
  notes?: string;
}): LogEntry {
  const sessions = read<Session[]>(K.sessions) ?? [];
  const climb = getClimbById(climbId);
  const user = getCurrentUser();

  // Find or create a session for today on the user's home board
  let session = sessions.find(
    (s) => s.userId === CURRENT_USER_ID && s.date === date
  );

  const entry: LogEntry = {
    id: crypto.randomUUID(),
    climbId,
    userId: CURRENT_USER_ID,
    date,
    attempts,
    sent,
    notes,
  };

  if (session) {
    session = { ...session, logEntries: [...session.logEntries, entry] };
    write(
      K.sessions,
      sessions.map((s) => (s.id === session!.id ? session! : s))
    );
  } else {
    const newSession: Session = {
      id: crypto.randomUUID(),
      userId: CURRENT_USER_ID,
      date,
      boardType: user.homeBoard,
      angle: user.homeBoardAngle,
      durationMinutes: 90,
      feelRating: 3,
      logEntries: [entry],
    };
    write(K.sessions, [...sessions, newSession]);
  }

  // Prepend a feed activity
  if (climb) {
    const activity: FeedActivity = {
      id: crypto.randomUUID(),
      user,
      climb,
      date: new Date().toISOString(),
      sent,
      rating: 3,
      comment: notes,
      commentsCount: 0,
    };
    const feed = read<FeedActivity[]>(K.feed) ?? [];
    write(K.feed, [activity, ...feed]);
  }

  return entry;
}

// ─── Feed ─────────────────────────────────────────────────────────────────────

export function getFeedActivities(): FeedActivity[] {
  return read<FeedActivity[]>(K.feed) ?? [];
}

// ─── Stats (computed from sessions) ──────────────────────────────────────────

export function computeStats(userId: string): ClimberStats {
  const sessions = getSessions(userId);
  const climbs = getClimbs();

  const climbGrade = (id: string): Grade | undefined =>
    climbs.find((c) => c.id === id)?.grade;
  const climbName = (id: string): string =>
    climbs.find((c) => c.id === id)?.name ?? id;

  // Flatten log entries
  const allEntries = sessions.flatMap((s) => s.logEntries);
  const sentEntries = allEntries.filter((e) => e.sent);

  // Grade pyramid
  const sendsByGrade: Partial<Record<Grade, number>> = {};
  for (const e of sentEntries) {
    const g = climbGrade(e.climbId);
    if (g) sendsByGrade[g] = (sendsByGrade[g] ?? 0) + 1;
  }
  const gradePyramid = ALL_GRADES.filter((g) => sendsByGrade[g])
    .map((g) => ({ grade: g, sends: sendsByGrade[g]! }))
    .reverse(); // hardest first

  // Session frequency: last 12 weeks
  const now = new Date();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const sessionFrequency = Array.from({ length: 12 }, (_, i) => {
    const weekStart = new Date(now.getTime() - (11 - i) * weekMs);
    const weekEnd   = new Date(weekStart.getTime() + weekMs);
    const label = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const count = sessions.filter((s) => {
      const d = new Date(s.date);
      return d >= weekStart && d < weekEnd;
    }).length;
    return { weekLabel: label, sessionCount: count };
  });

  // Progress over time: group by month
  const byMonth: Record<string, { grades: Grade[]; sends: number }> = {};
  for (const s of sessions) {
    const month = new Date(s.date).toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
    if (!byMonth[month]) byMonth[month] = { grades: [], sends: 0 };
    for (const e of s.logEntries.filter((e) => e.sent)) {
      byMonth[month].sends++;
      const g = climbGrade(e.climbId);
      if (g) byMonth[month].grades.push(g);
    }
  }
  const progressOverTime = Object.entries(byMonth).map(([month, { grades, sends }]) => {
    const highestGradeSent: Grade =
      grades.sort((a, b) => ALL_GRADES.indexOf(b) - ALL_GRADES.indexOf(a))[0] ?? "V0";
    return { month, highestGradeSent, totalSends: sends };
  });

  // Attempts vs sends per climb
  const climbStats: Record<string, { attempts: number; sends: number }> = {};
  for (const e of allEntries) {
    if (!climbStats[e.climbId]) climbStats[e.climbId] = { attempts: 0, sends: 0 };
    climbStats[e.climbId].attempts += e.attempts;
    if (e.sent) climbStats[e.climbId].sends++;
  }
  const attemptsVsSends = Object.entries(climbStats).map(([id, { attempts, sends }]) => ({
    climbId: id,
    climbName: climbName(id),
    grade: climbGrade(id) ?? "V0",
    attempts,
    sends,
  }));

  // Streak: consecutive weeks with at least one session
  let streak = 0;
  for (let i = sessionFrequency.length - 1; i >= 0; i--) {
    if (sessionFrequency[i].sessionCount > 0) streak++;
    else break;
  }

  return {
    userId,
    gradePyramid,
    sessionFrequency,
    progressOverTime,
    attemptsVsSends,
    totalSends: sentEntries.length,
    totalAttempts: allEntries.reduce((s, e) => s + e.attempts, 0),
    currentStreak: streak,
  };
}
