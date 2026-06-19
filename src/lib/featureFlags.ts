/**
 * Feature flag registry — the single source of truth for known flags.
 *
 * Flags are stored per-user as a flat `{ [key]: boolean }` object on
 * `users.feature_flags` (see the `add_feature_flags_to_users` migration) and
 * travel with the `User` object to the client, where they're loaded once at
 * page load by the `AuthProvider`.
 *
 * This module is intentionally free of React and server-only imports so it can
 * be used from both route handlers and client components.
 */

/** Every flag the application knows about. Add new keys here. */
export type FeatureFlagKey = "experimental_game" | "fiesta_mode";

/**
 * Default value for each flag when a user has no explicit setting. Keeping
 * defaults here (rather than scattered `?? false` checks) means a flag's
 * baseline behavior is described in exactly one place.
 */
export const FEATURE_FLAG_DEFAULTS: Record<FeatureFlagKey, boolean> = {
  // Gates the experimental "Game" leaderboard route. Public by default; a user
  // can still be opted out by explicitly setting this flag to false on their
  // account.
  experimental_game: true,
  // User-controlled "Fiesta Mode", toggled from their own profile page.
  fiesta_mode: false,
};

export type FeatureFlags = Partial<Record<FeatureFlagKey, boolean>>;

/**
 * Resolve whether a flag is enabled for a given flag object, falling back to
 * the registry default when the user has no explicit value.
 *
 * @param flags - the user's `featureFlags` object (may be undefined for
 *   logged-out visitors)
 * @param key - the flag to read
 */
export function isFeatureEnabled(
  flags: FeatureFlags | undefined | null,
  key: FeatureFlagKey,
): boolean {
  return flags?.[key] ?? FEATURE_FLAG_DEFAULTS[key];
}
