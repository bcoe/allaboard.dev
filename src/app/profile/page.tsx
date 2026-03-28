"use client";

import { useEffect, useState, useCallback } from "react";
import { UserTick } from "@/lib/types";
import { getUserTicks } from "@/lib/db";
import { useAuth } from "@/lib/auth-context";
import { ALL_GRADES, timeAgo } from "@/lib/utils";
import UserAvatar from "@/components/UserAvatar";
import GradeBadge from "@/components/GradeBadge";
import StarRating from "@/components/StarRating";
import TickModal from "@/components/TickModal";
import Link from "next/link";

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const [ticks, setTicks]         = useState<UserTick[]>([]);
  const [tickTarget, setTickTarget] = useState<{ id: string; name: string } | null>(null);

  const reload = useCallback(() => {
    if (!user) return;
    void (async () => {
      setTicks(await getUserTicks(user.id));
    })();
  }, [user]);

  useEffect(reload, [reload]);

  if (authLoading) {
    return <div className="text-stone-500 text-center py-16">Loading…</div>;
  }

  if (!user) {
    return (
      <div className="text-center py-24">
        <p className="text-stone-400 mb-4">Sign in to view your profile.</p>
        <a
          href="/api/auth/google"
          className="inline-block px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm transition-colors"
        >
          Login with Google
        </a>
      </div>
    );
  }

  // Aggregate stats from ticks
  const totalSent = ticks.filter((t) => t.sent).length;
  const sentGrades = ticks.filter((t) => t.sent).map((t) => t.grade);
  const hardestGrade = sentGrades.length > 0
    ? sentGrades.reduce((best, g) => ALL_GRADES.indexOf(g) > ALL_GRADES.indexOf(best) ? g : best)
    : null;

  return (
    <div className="max-w-2xl mx-auto">
      {tickTarget && (
        <TickModal
          climbId={tickTarget.id}
          climbName={tickTarget.name}
          onClose={() => setTickTarget(null)}
          onSuccess={reload}
        />
      )}

      {/* Header */}
      <div className="flex items-start gap-5">
        <UserAvatar user={user} size="lg" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white">{user.displayName}</h1>
          <p className="text-stone-400 text-sm mt-0.5">@{user.handle}</p>
          {user.bio && <p className="text-stone-300 text-sm mt-2 leading-relaxed">{user.bio}</p>}
          <div className="mt-2 text-xs text-stone-500">
            Home board: {user.homeBoard} at {user.homeBoardAngle}° ·{" "}
            Joined {new Date(user.joinedAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </div>
        </div>
      </div>

      {/* Aggregate stat tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-8">
        <Tile value={totalSent} label="Total Sends" accent="text-green-400" />
        <Tile value={ticks.length} label="Total Ticks" />
        <div className="bg-stone-800 border border-stone-700 rounded-xl px-4 py-3 text-center">
          {hardestGrade ? (
            <>
              <div className="flex justify-center mb-1">
                <GradeBadge grade={hardestGrade} size="md" />
              </div>
              <div className="text-stone-400 text-xs mt-0.5">Hardest Send</div>
            </>
          ) : (
            <>
              <div className="text-2xl font-bold text-stone-600">—</div>
              <div className="text-stone-400 text-xs mt-0.5">Hardest Send</div>
            </>
          )}
        </div>
        <div className="bg-stone-800 border border-stone-700 rounded-xl px-4 py-3 text-center">
          <div className="text-2xl font-bold text-white">{user.followersCount}</div>
          <div className="text-stone-400 text-xs mt-0.5">Followers</div>
        </div>
      </div>

      {/* Personal bests */}
      {Object.keys(user.personalBests).length > 0 && (
        <section className="mt-8">
          <h2 className="text-white font-semibold text-lg mb-3">Personal Bests</h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(user.personalBests).map(([board, grade]) => grade && (
              <div key={board} className="bg-stone-800 border border-stone-700 rounded-lg px-4 py-3 flex items-center gap-3">
                <span className="text-stone-400 text-sm">{board}</span>
                <GradeBadge grade={grade} size="md" />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Stats link */}
      <section className="mt-8">
        <Link
          href="/stats"
          className="flex items-center justify-between bg-stone-800 border border-stone-700 hover:border-stone-500 rounded-xl px-5 py-4 transition-colors"
        >
          <div>
            <div className="text-white font-semibold">My Stats</div>
            <div className="text-stone-400 text-sm mt-0.5">Grade pyramid, session frequency, progress over time</div>
          </div>
          <span className="text-stone-400 text-lg">→</span>
        </Link>
      </section>

      {/* Tick list */}
      <section className="mt-8 pb-8">
        <h2 className="text-white font-semibold text-lg mb-3">Tick List</h2>
        {ticks.length === 0 ? (
          <p className="text-stone-500 text-sm">No ticks yet. Go send something!</p>
        ) : (
          <div className="flex flex-col gap-3">
            {ticks.map((tick) => (
              <TickCard
                key={tick.id}
                tick={tick}
                onRetick={() => setTickTarget({ id: tick.climbId, name: tick.climbName })}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({ value, label, accent }: { value: number; label: string; accent?: string }) {
  return (
    <div className="bg-stone-800 border border-stone-700 rounded-xl px-4 py-3 text-center">
      <div className={`text-2xl font-bold ${accent ?? "text-white"}`}>{value}</div>
      <div className="text-stone-400 text-xs mt-0.5">{label}</div>
    </div>
  );
}

function TickCard({ tick, onRetick }: { tick: UserTick; onRetick: () => void }) {
  return (
    <div className="bg-stone-800 border border-stone-700 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {tick.sent ? (
              <span className="text-green-400 text-xs font-semibold">Sent</span>
            ) : (
              <span className="text-stone-400 text-xs">Working</span>
            )}
            <GradeBadge grade={tick.grade} />
            <span className="text-white font-semibold text-sm truncate">{tick.climbName}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-3 flex-wrap">
            <StarRating value={Math.round(tick.rating)} size="sm" />
            {tick.boardName && (
              <span className="text-stone-500 text-xs">{tick.boardName} · {tick.angle}°</span>
            )}
            <span className="text-stone-600 text-xs">{timeAgo(tick.date)}</span>
          </div>
          {tick.comment && (
            <p className="mt-2 text-stone-400 text-sm leading-relaxed">{tick.comment}</p>
          )}
        </div>
        <button
          onClick={onRetick}
          className="text-xs text-stone-500 hover:text-orange-400 transition-colors shrink-0 mt-0.5"
          title="Update tick"
        >
          Edit
        </button>
      </div>
    </div>
  );
}
