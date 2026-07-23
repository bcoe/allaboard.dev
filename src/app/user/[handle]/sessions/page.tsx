"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getUserSessions } from "@/lib/db";
import { TickSessionSummary } from "@/lib/types";
import { sessionTitle, formatDuration } from "@/lib/utils";
import GradeBadge from "@/components/GradeBadge";

export default function UserSessionsPage() {
  const params = useParams<{ handle: string }>();
  const handle = params.handle;

  const [sessions, setSessions] = useState<TickSessionSummary[] | null>(null);

  useEffect(() => {
    if (!handle) return;
    void getUserSessions(handle).then(setSessions).catch(() => setSessions([]));
  }, [handle]);

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        href={`/user/${handle}`}
        className="inline-flex items-center gap-1 text-sm text-stone-400 hover:text-white transition-colors"
      >
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M10 3L5 8l5 5" />
        </svg>
        Back to @{handle}
      </Link>

      <h1 className="text-2xl font-bold text-white mt-4">Sessions</h1>
      <p className="text-stone-400 text-sm mt-1">Summarizing @{handle}&apos;s climbing workouts</p>

      <section className="mt-6 pb-8">
        {sessions === null ? (
          <p className="text-stone-500 text-sm">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="text-stone-500 text-sm">No sessions yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {sessions.map((s) => (
              <Link
                key={s.id}
                href={`/user/${handle}/sessions/${encodeURIComponent(s.id)}`}
                className="block bg-stone-800 border border-stone-700 hover:border-stone-500 rounded-xl p-4 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-white font-semibold truncate">
                      {sessionTitle(s.date, s.sessionNumber)}
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 flex-wrap text-stone-500 text-xs">
                      <span>{s.tickCount} {s.tickCount === 1 ? "climb" : "climbs"}</span>
                      <span>{s.sentCount} sent</span>
                      <span>
                        {s.totalMinutes != null ? formatDuration(s.totalMinutes) : "No time recorded"}
                      </span>
                    </div>
                  </div>
                  {s.hardestGrade && (
                    <div className="shrink-0">
                      <GradeBadge grade={s.hardestGrade} />
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
