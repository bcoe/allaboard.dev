/**
 * Data access layer — calls Next.js API route handlers at /api/*.
 * Credentials are included on every request so the auth session cookie is sent.
 */

import { Board, Climb, ClimbTick, Tick, UserTick, User, Session, LogEntry, ClimberStats, FeedActivity, Comment, InboxItem, TickSessionSummary, TickSessionDetail, SessionImage } from "@/lib/types";
import type { FeatureFlags } from "@/lib/featureFlags";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...init,
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── No-op stubs kept for API compatibility ───────────────────────────────────

export function initStorage(): void { /* no-op */ }
export function resetStorage(): void { /* no-op */ }

// ─── Climbs ───────────────────────────────────────────────────────────────────

export interface ClimbFilters {
  q?: string;
  gradeMin?: string;
  gradeMax?: string;
  angleMin?: number;
  angleMax?: number;
  boardIds?: string[];
  sort?: string;
  limit?: number;
  offset?: number;
}

export async function getClimbs(filters?: ClimbFilters): Promise<{ climbs: Climb[]; hasMore: boolean; total: number }> {
  const params = new URLSearchParams();
  if (filters?.q)                        params.set("q",        filters.q);
  if (filters?.gradeMin)                 params.set("gradeMin", filters.gradeMin);
  if (filters?.gradeMax)                 params.set("gradeMax", filters.gradeMax);
  if (filters?.angleMin != null)         params.set("angleMin", String(filters.angleMin));
  if (filters?.angleMax != null)         params.set("angleMax", String(filters.angleMax));
  if (filters?.boardIds?.length)         params.set("boardIds", filters.boardIds.join(","));
  if (filters?.sort)                     params.set("sort",     filters.sort);
  if (filters?.limit  != null)           params.set("limit",    String(filters.limit));
  if (filters?.offset != null)           params.set("offset",   String(filters.offset));
  const qs = params.toString();
  return api<{ climbs: Climb[]; hasMore: boolean; total: number }>(`/climbs${qs ? `?${qs}` : ""}`);
}

export async function getClimbById(id: string): Promise<Climb | undefined> {
  try {
    return await api<Climb>(`/climbs/${id}`);
  } catch {
    return undefined;
  }
}

export async function createClimb(data: {
  name: string;
  grade: string;
  boardId: string;
  angle?: number;
  description?: string;
  setter?: string;
}): Promise<Climb> {
  return api<Climb>("/climbs", { method: "POST", body: JSON.stringify(data) });
}

export async function updateClimb(
  id: string,
  patch: Partial<{ name: string; grade: string; boardId: string; angle: number; description: string; setter: string }>,
): Promise<Climb> {
  return api<Climb>(`/climbs/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export async function tickClimb(
  climbId: string,
  data: { date: string; sent: boolean; attempts?: number; durationMinutes?: number; suggestedGrade?: string; rating: number; comment?: string; instagramUrl?: string },
): Promise<Tick> {
  return api<Tick>(`/climbs/${climbId}/ticks`, { method: "POST", body: JSON.stringify(data) });
}

export async function getUserTicks(userId: string): Promise<UserTick[]> {
  return api<UserTick[]>(`/ticks?userId=${encodeURIComponent(userId)}`);
}

export async function updateTick(
  tickId: string,
  data: { date: string; sent: boolean; attempts?: number; durationMinutes?: number; suggestedGrade?: string; rating: number; comment?: string; instagramUrl?: string },
): Promise<void> {
  await api<void>(`/ticks/${encodeURIComponent(tickId)}`, { method: "PATCH", body: JSON.stringify(data) });
}

export async function deleteTick(tickId: string): Promise<void> {
  await api<void>(`/ticks/${encodeURIComponent(tickId)}`, { method: "DELETE" });
}

export async function getClimbTicks(climbId: string): Promise<ClimbTick[]> {
  return api<ClimbTick[]>(`/climbs/${climbId}/ticks`);
}

// ─── Sessions (derived from ticks) ──────────────────────────────────────────

/** List a user's climbing sessions, most recent first. */
export async function getUserSessions(userId: string): Promise<TickSessionSummary[]> {
  return api<TickSessionSummary[]>(`/tick-sessions?userId=${encodeURIComponent(userId)}`);
}

/** Fetch a single session (with its climbs) by permalink slug. */
export async function getSession(id: string): Promise<TickSessionDetail | undefined> {
  try {
    return await api<TickSessionDetail>(`/tick-sessions/${encodeURIComponent(id)}`);
  } catch {
    return undefined;
  }
}

/** Check whether a session has an AI-generated header banner yet. */
export async function getSessionImage(id: string): Promise<SessionImage> {
  return api<SessionImage>(`/tick-sessions/${encodeURIComponent(id)}/image`);
}

/**
 * Ask the server to generate this session's header banner.
 *
 * Any signed-in climber may do this for any session, and it is a no-op if one
 * already exists. The request is held for the whole pipeline (~20–30s), so
 * callers should show a placeholder meanwhile.
 *
 * Pass `force` when the climber is explicitly retrying a session that has
 * already spent its automatic retry budget — the server honours it for the
 * session's owner only.
 */
export async function generateSessionImage(id: string, force = false): Promise<SessionImage> {
  const qs = force ? "?retry=1" : "";
  return api<SessionImage>(`/tick-sessions/${encodeURIComponent(id)}/image${qs}`, { method: "POST" });
}

/**
 * Replace a session's finished banner with a newly generated one.
 *
 * The only way past the generate-once rule, and the only call here that spends
 * inference on a session that already has a perfectly good image — so it
 * belongs to a deliberate button press, never to page load. Requires auth; the
 * returned `url` carries a fresh `?v=` stamp so the new picture is not masked
 * by the cached old one.
 */
export async function regenerateSessionImage(id: string): Promise<SessionImage> {
  return api<SessionImage>(
    `/tick-sessions/${encodeURIComponent(id)}/image?regenerate=1`,
    { method: "POST" },
  );
}


// ─── Users ────────────────────────────────────────────────────────────────────

export async function getUsers(): Promise<User[]> {
  return api<User[]>("/users");
}

export async function getUserById(id: string): Promise<User | undefined> {
  try {
    return await api<User>(`/users/${id}`);
  } catch {
    return undefined;
  }
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    return await api<User>("/auth/me");
  } catch {
    return null;
  }
}

export async function updateCurrentUser(userId: string, patch: Partial<Omit<User, "id">>): Promise<User> {
  return api<User>(`/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export async function setFeatureFlag(
  handle: string,
  flag: string,
  enabled: boolean,
): Promise<{ featureFlags: FeatureFlags }> {
  return api<{ featureFlags: FeatureFlags }>(
    `/users/${encodeURIComponent(handle)}/feature-flags`,
    { method: "PATCH", body: JSON.stringify({ flag, enabled }) },
  );
}

export async function getFollowers(handle: string): Promise<User[]> {
  return api<User[]>(`/users/${encodeURIComponent(handle)}/followers`);
}

export async function getFollowing(handle: string): Promise<User[]> {
  return api<User[]>(`/users/${encodeURIComponent(handle)}/following`);
}

export async function checkFollowing(handle: string): Promise<boolean> {
  const { following } = await api<{ following: boolean }>(`/users/${encodeURIComponent(handle)}/follow`);
  return following;
}

export async function followUser(handle: string): Promise<void> {
  await api<{ following: boolean }>(`/users/${encodeURIComponent(handle)}/follow`, { method: "POST" });
}

export async function unfollowUser(handle: string): Promise<void> {
  await api<{ following: boolean }>(`/users/${encodeURIComponent(handle)}/follow`, { method: "DELETE" });
}

// ─── Boards ───────────────────────────────────────────────────────────────────

export async function getBoards(type?: "standard" | "spray_wall"): Promise<Board[]> {
  const qs = type ? `?type=${type}` : "";
  return api<Board[]>(`/boards${qs}`);
}

export async function createBoard(data: {
  name: string;
  type: "standard" | "spray_wall";
  location?: string;
  description?: string;
}): Promise<Board> {
  return api<Board>("/boards", { method: "POST", body: JSON.stringify(data) });
}

export async function updateBoard(
  id: string,
  patch: { name?: string; location?: string; description?: string },
): Promise<Board> {
  return api<Board>(`/boards/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export async function getSessions(userId?: string): Promise<Session[]> {
  const qs = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  return api<Session[]>(`/sessions${qs}`);
}

export async function logClimb({
  climbId, date, attempts, sent, notes, userId,
}: {
  climbId: string;
  date: string;
  attempts: number;
  sent: boolean;
  notes?: string;
  userId: string;
}): Promise<LogEntry> {
  return api<LogEntry>("/log-entries", {
    method: "POST",
    body: JSON.stringify({ climbId, date, attempts, sent, notes, userId }),
  });
}

// ─── Feed ─────────────────────────────────────────────────────────────────────

export async function getFeedActivities(
  followingOf?: string,
  { limit = 25, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<{ activities: FeedActivity[]; hasMore: boolean }> {
  const params = new URLSearchParams();
  if (followingOf) params.set("followingOf", followingOf);
  params.set("limit",  String(limit));
  params.set("offset", String(offset));
  return api<{ activities: FeedActivity[]; hasMore: boolean }>(`/feed?${params.toString()}`);
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export async function computeStats(userId: string): Promise<ClimberStats> {
  return api<ClimberStats>(`/stats/${userId}`);
}

// ─── Imports ──────────────────────────────────────────────────────────────────

export interface AuroraImportResult {
  imported: number;
  climbsCreated: number;
  skipped: number;
  skipDetails: {
    missingName: number;
    unknownGrade: number;
    invalidAngle: number;
    alreadyImported: number;
  };
}

export async function importAuroraData(
  handle: string,
  data: unknown,
): Promise<AuroraImportResult> {
  return api<AuroraImportResult>(`/users/${encodeURIComponent(handle)}/import/aurora`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export interface MoonboardImportResult {
  imported: number;
  climbsCreated: number;
  boardsCreated: number;
  skipped: number;
  skipDetails: {
    missingName: number;
    unknownGrade: number;
    alreadyImported: number;
    notSent: number;
  };
}

export async function importMoonboardData(
  handle: string,
  data: unknown,
  boardName?: string,
): Promise<MoonboardImportResult> {
  const qs = boardName ? `?boardName=${encodeURIComponent(boardName)}` : "";
  return api<MoonboardImportResult>(`/users/${encodeURIComponent(handle)}/import/moonboard${qs}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export async function getTickComments(tickId: string): Promise<Comment[]> {
  return api<Comment[]>(`/comments?tickId=${encodeURIComponent(tickId)}`);
}

export async function postComment(data: {
  tickId: string;
  body: string;
  parentCommentId?: string;
}): Promise<Comment> {
  return api<Comment>("/comments", { method: "POST", body: JSON.stringify(data) });
}

export async function updateComment(id: string, body: string): Promise<Comment> {
  return api<Comment>(`/comments/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ body }) });
}

export async function deleteComment(id: string): Promise<void> {
  await api<void>(`/comments/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ─── Inbox ────────────────────────────────────────────────────────────────────

export async function getInbox(): Promise<{ items: InboxItem[]; unreadCount: number }> {
  return api<{ items: InboxItem[]; unreadCount: number }>("/inbox");
}

export async function markInboxItemRead(id: string): Promise<void> {
  await api<void>(`/inbox/${encodeURIComponent(id)}`, { method: "PATCH" });
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

export interface HardestGradeTick {
  id: string;
  climbId: string;
  climbName: string;
  grade: string;
  boardName: string;
  angle: number | null;
  attempts?: number;
  date: string;
}

export interface LeaderboardEntry {
  id: string;
  handle: string;
  displayName: string;
  avatarColor: string;
  profilePictureUrl?: string;
  points: number;
  totalTicks: number;
  hardestGrade: string | null;
  hardestGradeTicks: HardestGradeTick[];
}

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  return api<LeaderboardEntry[]>("/leaderboard");
}

export interface BoardDifficultyResult {
  lines: string[];
  boardScores: Record<string, number>;
}

export async function recalculateBoardDifficulty(): Promise<BoardDifficultyResult> {
  return api<BoardDifficultyResult>("/admin/recalculate-board-difficulty", {
    method: "POST",
  });
}

export async function getSetterSuggestions(q: string): Promise<string[]> {
  if (!q.trim()) return [];
  return api<string[]>(`/api/setters?q=${encodeURIComponent(q)}&limit=8`);
}
