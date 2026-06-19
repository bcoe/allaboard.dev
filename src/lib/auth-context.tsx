"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import * as Sentry from "@sentry/nextjs";
import type { User } from "./types";
import { isFeatureEnabled, type FeatureFlagKey } from "./featureFlags";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  logout: () => void;
  updateUser: (u: User) => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  logout: () => {},
  updateUser: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  function syncSentryUser(u: User | null) {
    if (u) {
      Sentry.setUser({ id: u.id, username: u.handle });
    } else {
      Sentry.setUser(null);
    }
  }

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((u: User | null) => {
        setUser(u);
        syncSentryUser(u);
      })
      .catch(() => {
        setUser(null);
        syncSentryUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  function logout() {
    fetch("/api/auth/logout", { method: "POST", credentials: "include" })
      .finally(() => {
        setUser(null);
        syncSentryUser(null);
      });
  }

  return (
    <AuthContext.Provider value={{ user, loading, logout, updateUser: (u) => { setUser(u); syncSentryUser(u); } }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

/**
 * Read a single feature flag for the current user. Flags are loaded once at
 * page load (via `/api/auth/me`), so this is a synchronous lookup against the
 * already-resolved user. Logged-out visitors and users without an explicit
 * value fall back to the registry default in `featureFlags.ts`.
 */
export function useFeatureFlag(key: FeatureFlagKey): boolean {
  const { user } = useAuth();
  return isFeatureEnabled(user?.featureFlags, key);
}
