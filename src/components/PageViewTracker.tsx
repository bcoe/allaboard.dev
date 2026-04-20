"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import * as Sentry from "@sentry/nextjs";

/**
 * Replace dynamic path segments so that metrics group by route shape, not by
 * individual ID values:
 *   /climbs/3f2e1d…  →  /climbs/:id
 *   /user/alice      →  /user/:handle
 */
function normalizePath(pathname: string): string {
  return pathname
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ":id",
    )
    .replace(/^(\/user\/)([^/]+)/, "$1:handle");
}

/**
 * Emits a `page.view` metric on every pathname change (initial load and
 * client-side navigations). Renders nothing — intended for the root layout.
 */
export default function PageViewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    const route = normalizePath(pathname);
    Sentry.metrics.count("page.view", 1, { attributes: { route } });
    Sentry.metrics.gauge(
      "queue.backlog",
      Math.floor(Math.random() * 9) + 2,
      { attributes: { route } },
    );
  }, [pathname]);

  return null;
}
