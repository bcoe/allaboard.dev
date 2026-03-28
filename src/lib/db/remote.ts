/**
 * Remote (Postgres-backed) implementation of the data layer.
 * Calls the Express API running on localhost:3001.
 */

import { Climb, User, Session, LogEntry, ClimberStats, FeedActivity } from "@/lib/types";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

// ─── No-op stubs kept for API compatibility ───────────────────────────────────

export function initStorage(): void { /* no-op: DB is always ready */ }
export function resetStorage(): void { /* no-op */ }

// ─── Climbs ───────────────────────────────────────────────────────────────────

export async function getClimbs(): Promise<Climb[]> {
  return api<Climb[]>("/climbs");
}

export async function getClimbById(id: string): Promise<Climb | undefined> {
  try {
    return await api<Climb>(`/climbs/${id}`);
  } catch {
    return undefined;
  }
}

export async function createClimb(data: Omit<Climb, "id" | "createdAt" | "author">): Promise<Climb> {
  return api<Climb>("/climbs", { method: "POST", body: JSON.stringify(data) });
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

export async function getCurrentUser(): Promise<User> {
  return api<User>("/users/alex_sends");
}

export async function updateCurrentUser(patch: Partial<Omit<User, "id">>): Promise<User> {
  return api<User>("/users/alex_sends", { method: "PATCH", body: JSON.stringify(patch) });
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export async function getSessions(userId?: string): Promise<Session[]> {
  const qs = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  return api<Session[]>(`/sessions${qs}`);
}

export async function logClimb({
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
}): Promise<LogEntry> {
  return api<LogEntry>("/log-entries", {
    method: "POST",
    body: JSON.stringify({ climbId, date, attempts, sent, notes, userId: "alex_sends" }),
  });
}

// ─── Feed ─────────────────────────────────────────────────────────────────────

export async function getFeedActivities(): Promise<FeedActivity[]> {
  return api<FeedActivity[]>("/feed?userId=alex_sends");
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export async function computeStats(userId: string): Promise<ClimberStats> {
  return api<ClimberStats>(`/stats/${userId}`);
}
