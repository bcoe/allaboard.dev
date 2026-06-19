"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { useAuth } from "@/lib/auth-context";

export default function ProfileRedirect() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    // Runtime decision: where /profile sends the visitor depends on whether
    // they're signed in — log both the reason and the resulting destination.
    const redirect = user ? `/user/${user.handle}` : "/api/auth/google";
    Sentry.logger.info("Redirect", { authenticated: Boolean(user), redirect });
    router.replace(redirect);
  }, [user, loading, router]);

  return <div className="text-stone-500 text-center py-16">Redirecting…</div>;
}
