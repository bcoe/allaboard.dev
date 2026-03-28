/**
 * Data access layer — calls Next.js API route handlers at /api/*.
 * Credentials are included on every request so the auth session cookie is sent.
 */

import { Climb, Tick, UserTick, User, Session, LogEntry, ClimberStats, FeedActivity } from "@/lib/types";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...init,
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
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
  boardId?: string;
  limit?: number;
  offset?: number;
}

export async function getClimbs(filters?: ClimbFilters): Promise<{ climbs: Climb[]; hasMore: boolean }> {
  const params = new URLSearchParams();
  if (filters?.q)             params.set("q",        filters.q);
  if (filters?.gradeMin)      params.set("gradeMin", filters.gradeMin);
  if (filters?.gradeMax)      params.set("gradeMax", filters.gradeMax);
  if (filters?.angleMin != null) params.set("angleMin", String(filters.angleMin));
  if (filters?.angleMax != null) params.set("angleMax", String(filters.angleMax));
  if (filters?.boardId)       params.set("boardId",  filters.boardId);
  if (filters?.limit  != null) params.set("limit",   String(filters.limit));
  if (filters?.offset != null) params.set("offset",  String(filters.offset));
  const qs = params.toString();
  return api<{ climbs: Climb[]; hasMore: boolean }>(`/climbs${qs ? `?${qs}` : ""}`);
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
  data: { date: string; sent: boolean; suggestedGrade?: string; rating: number; comment?: string; instagramUrl?: string },
): Promise<Tick> {
  return api<Tick>(`/climbs/${climbId}/ticks`, { method: "POST", body: JSON.stringify(data) });
}

export async function getUserTicks(userId: string): Promise<UserTick[]> {
  return api<UserTick[]>(`/ticks?userId=${encodeURIComponent(userId)}`);
}

export async function getClimbTicks(climbId: string): Promise<Tick[]> {
  return api<Tick[]>(`/climbs/${climbId}/ticks`);
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

export async function getFeedActivities(userId?: string): Promise<FeedActivity[]> {
  const qs = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  return api<FeedActivity[]>(`/feed${qs}`);
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export async function computeStats(userId: string): Promise<ClimberStats> {
  return api<ClimberStats>(`/stats/${userId}`);
}
