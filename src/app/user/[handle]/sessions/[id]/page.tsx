"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/db";
import { TickSessionDetail, UserTick } from "@/lib/types";
import { sessionTitle, formatDuration, timeAgo } from "@/lib/utils";
import { buildSessionSummaryText } from "@/lib/sessionSummary";
import GradeBadge from "@/components/GradeBadge";
import StarRating from "@/components/StarRating";

export default function SessionDetailPage() {
  const params = useParams<{ handle: string; id: string }>();
  const { handle, id } = params;

  const [session, setSession] = useState<TickSessionDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;
    void getSession(id).then((s) => {
      if (!s) setNotFound(true);
      else setSession(s);
    });
  }, [id]);

  function handleCopy() {
    if (!session) return;
    void navigator.clipboard.writeText(buildSessionSummaryText(session));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (notFound) {
    return <div className="text-center py-24 text-stone-500">Session not found.</div>;
  }
  if (!session) {
    return <div className="text-stone-500 text-center py-16">Loading…</div>;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        href={`/user/${handle}/sessions`}
        className="inline-flex items-center gap-1 text-sm text-stone-400 hover:text-white transition-colors"
      >
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M10 3L5 8l5 5" />
        </svg>
        Back to sessions
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 mt-4">
        <h1 className="text-2xl font-bold text-white">
          {sessionTitle(session.date, session.sessionNumber)}
        </h1>
        <button
          onClick={handleCopy}
          className="shrink-0 px-3 py-2 bg-orange-500 hover:bg-orange-400 text-white text-xs font-medium rounded-lg transition-colors"
        >
          {copied ? "Copied!" : "Copy summary"}
        </button>
      </div>

      {/* Session stats */}
      <div className="grid grid-cols-2 gap-3 mt-6">
        <div className="bg-stone-800 border border-stone-700 rounded-xl px-4 py-3 text-center">
          {session.hardestGrade ? (
            <div className="flex justify-center mb-1">
              <GradeBadge grade={session.hardestGrade} size="md" />
            </div>
          ) : (
            <div className="text-2xl font-bold text-stone-600">—</div>
          )}
          <div className="text-stone-400 text-xs mt-0.5">Hardest Send</div>
        </div>
        <div className="bg-stone-800 border border-stone-700 rounded-xl px-4 py-3 text-center">
          <div className={`text-2xl font-bold ${session.totalMinutes != null ? "text-white" : "text-stone-600"}`}>
            {session.totalMinutes != null ? formatDuration(session.totalMinutes) : "—"}
          </div>
          <div className="text-stone-400 text-xs mt-0.5">
            {session.totalMinutes != null ? "Time Spent" : "No time recorded"}
          </div>
        </div>
      </div>

      {/* Climbs */}
      <section className="mt-6 pb-8 flex flex-col gap-3">
        {session.ticks.map((tick) => (
          <SessionClimbCard key={tick.id} tick={tick} />
        ))}
      </section>
    </div>
  );
}

function SessionClimbCard({ tick }: { tick: UserTick }) {
  return (
    <div className="bg-stone-800 border border-stone-700 rounded-xl p-4">
      <div className="flex items-center gap-2 flex-wrap">
        {tick.sent ? (
          <span className="text-green-400 text-xs font-semibold">Sent</span>
        ) : (
          <span className="text-stone-400 text-xs">Working</span>
        )}
        <GradeBadge grade={tick.grade} />
        <Link
          href={`/climbs/${tick.climbId}`}
          className="text-white font-semibold text-sm truncate hover:text-orange-400 transition-colors"
        >
          {tick.climbName}
        </Link>
      </div>
      <div className="mt-1.5 flex items-center gap-3 flex-wrap">
        <StarRating value={Math.round(tick.rating)} size="sm" />
        {tick.boardName && (
          <span className="text-stone-500 text-xs">
            {tick.boardName} · {tick.angle}°
          </span>
        )}
        {tick.attempts != null && (
          <span className="text-stone-500 text-xs">
            {tick.attempts} {tick.attempts === 1 ? "attempt" : "attempts"}
          </span>
        )}
        {tick.durationMinutes != null && (
          <span className="text-stone-500 text-xs">{formatDuration(tick.durationMinutes)}</span>
        )}
        <span className="text-stone-600 text-xs">{timeAgo(tick.date)}</span>
      </div>
      {tick.comment && (
        <p className="mt-2 text-stone-400 text-sm leading-relaxed">{tick.comment}</p>
      )}
    </div>
  );
}
