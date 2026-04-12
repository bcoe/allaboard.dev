"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLeaderboard, type LeaderboardEntry, type HardestGradeTick } from "@/lib/db";
import { Grade } from "@/lib/types";
import { timeAgo } from "@/lib/utils";
import GradeBadge from "@/components/GradeBadge";
import UserAvatar from "@/components/UserAvatar";

// ── Hex equivalents of GRADE_COLORS (mirrors stats page) ──────────────────────
const GRADE_HEX: Record<string, string> = {
  V0:   "#15803d", V1:  "#16a34a", V2:  "#22c55e", V3:  "#84cc16",
  V4:   "#eab308", V5:  "#f59e0b", "V5+": "#d97706", V6:  "#f97316",
  V7:   "#ea580c", V8:  "#ef4444", "V8+": "#dc2626", V9:  "#b91c1c",
  V10:  "#991b1b", V11: "#be123c", V12: "#9333ea",  V13: "#7e22ce",
  V14:  "#db2777", V15: "#be185d", V16: "#86198f",  V17: "#4a044e",
  V18:  "#1c1917",
};

// ── Medal styles for ranks 1–3 ────────────────────────────────────────────────
const MEDAL_CONFIG: Record<number, { emoji: string }> = {
  1: { emoji: "🥇" },
  2: { emoji: "🥈" },
  3: { emoji: "🥉" },
};

// ── Hardest-grade hover tooltip ───────────────────────────────────────────────

function HardestGradeTooltip({ ticks }: { ticks: HardestGradeTick[] }) {
  const shown = ticks.slice(0, 5);
  return (
    <div className="bg-stone-950 border border-stone-700 rounded-xl px-3 py-2.5 shadow-2xl min-w-[160px] max-w-[260px] w-max">
      {shown.map((tick, i) => (
        <div key={tick.id}>
          {i > 0 && <div className="border-t border-stone-800 my-1.5" />}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="text-white text-[10px] font-bold px-1.5 py-0.5 rounded inline-block"
              style={{ background: GRADE_HEX[tick.grade] ?? "#78716c" }}
            >
              {tick.grade}
            </span>
            <span className="text-white text-xs font-semibold leading-snug">{tick.climbName}</span>
          </div>
          <div className="text-stone-500 text-[10px] mt-0.5">
            {[
              tick.boardName && `${tick.boardName}${tick.angle != null ? ` · ${tick.angle}°` : ""}`,
              tick.attempts != null ? `${tick.attempts} att.` : null,
              timeAgo(tick.date.slice(0, 10)),
            ].filter(Boolean).join(" · ")}
          </div>
        </div>
      ))}
      {ticks.length > 5 && (
        <div className="text-stone-600 text-[10px] mt-1.5">+{ticks.length - 5} more</div>
      )}
    </div>
  );
}

function HardestGradeCell({ grade, ticks }: { grade: string | null; ticks: HardestGradeTick[] }) {
  if (!grade) return <span className="text-stone-600 text-sm">—</span>;

  return (
    <div className="relative group inline-flex cursor-default">
      <GradeBadge grade={grade as Grade} size="sm" />
      {ticks.length > 0 && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50
                        opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <HardestGradeTooltip ticks={ticks} />
        </div>
      )}
    </div>
  );
}

// ── Leaderboard card ──────────────────────────────────────────────────────────

function LeaderboardCard({ entry, rank }: { entry: LeaderboardEntry; rank: number }) {
  const medal = MEDAL_CONFIG[rank];

  // Construct a minimal User-shaped object for UserAvatar
  const userForAvatar = {
    id:               entry.id,
    handle:           entry.handle,
    displayName:      entry.displayName,
    avatarColor:      entry.avatarColor,
    profilePictureUrl: entry.profilePictureUrl,
  } as Parameters<typeof UserAvatar>[0]["user"];

  return (
    <div className="bg-stone-800 border border-stone-700 rounded-xl px-5 py-4 flex items-center gap-4">

      {/* ── Medal / rank — fixed width so all cards align identically ── */}
      <div className="shrink-0 w-10 flex items-center justify-center">
        {medal ? (
          <span
            data-testid="medal-badge"
            className="text-3xl leading-none"
            aria-label={`Rank ${rank}`}
          >
            {medal.emoji}
          </span>
        ) : (
          <span className="text-stone-600 text-sm font-medium tabular-nums w-10 text-center">
            {rank}
          </span>
        )}
      </div>

      {/* ── Avatar ── */}
      <Link href={`/user/${entry.handle}`} className="shrink-0">
        <UserAvatar user={userForAvatar} size="lg" />
      </Link>

      {/* ── Handle + stats ── */}
      <div className="flex-1 min-w-0">
        <Link
          href={`/user/${entry.handle}`}
          className="text-white font-semibold hover:text-orange-400 transition-colors truncate block"
        >
          @{entry.handle}
        </Link>
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          <span className="text-stone-400 text-xs">
            <span className="text-stone-200 font-medium">{entry.totalTicks}</span>
            {" "}ticks
          </span>
          <span className="text-stone-600 text-xs">·</span>
          <span className="text-stone-400 text-xs flex items-center gap-1">
            <span className="text-stone-500 text-xs">Hardest</span>
            <HardestGradeCell grade={entry.hardestGrade} ticks={entry.hardestGradeTicks} />
          </span>
        </div>
      </div>

      {/* ── Points chip ── */}
      <div className="shrink-0">
        <span className="border border-orange-500 text-orange-400 font-bold
                         px-3 py-1 rounded text-sm tabular-nums whitespace-nowrap">
          {entry.points.toLocaleString()} pts
        </span>
      </div>

    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GamePage() {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    getLeaderboard()
      .then(setEntries)
      .catch(() => setError("Failed to load leaderboard."));
  }, []);

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-black text-white mb-1">Climbing Game</h1>
      <p className="text-stone-400 text-sm mb-8">
        Climbers ranked by points. Earn points by sending climbs — harder grades,
        tougher boards, and flashes score higher.
      </p>

      {error && (
        <p className="text-red-400 text-sm">{error}</p>
      )}

      {!entries && !error && (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-stone-800 border border-stone-700 rounded-xl px-5 py-4 h-20 animate-pulse" />
          ))}
        </div>
      )}

      {entries && (
        <div className="space-y-3">
          {entries.map((entry, i) => (
            <LeaderboardCard key={entry.id} entry={entry} rank={i + 1} />
          ))}
          {entries.length === 0 && (
            <p className="text-stone-500 text-sm text-center py-16">
              No climbers yet.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
