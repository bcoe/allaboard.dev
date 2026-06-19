"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { useAuth, useFeatureFlag } from "@/lib/auth-context";

/**
 * Route guard for the experimental Game leaderboard.
 *
 * The Game experience is gated behind a per-user feature flag that arrives with
 * the user at page load. This layout is the routing decision: it waits for the
 * flag to resolve, then either renders the route or redirects opted-out
 * visitors home. The decision (and the inputs behind it) is logged so it's
 * clear, after the fact, why a given user did or didn't see the experiment.
 *
 * The guard lives in the layout rather than the page so the page component
 * stays a pure presentational unit.
 */
export default function GameLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { loading: authLoading } = useAuth();
  const gameEnabled = useFeatureFlag("experimental_game");

  useEffect(() => {
    if (authLoading) return;
    Sentry.logger.info("Check Feature Flags", {
      "feature_flag.key": "experimental_game",
      "feature_flag.enabled": gameEnabled,
      route: "/game",
      "routing.decision": gameEnabled ? "render" : "redirect_home",
    });
    if (!gameEnabled) router.replace("/");
  }, [authLoading, gameEnabled, router]);

  // Hold rendering until the flag resolves, and while a redirect is in flight
  // for opted-out users, so the experimental UI never flashes.
  if (authLoading || !gameEnabled) {
    return <main className="max-w-[1200px] mx-auto px-4 py-10" />;
  }

  return <>{children}</>;
}
