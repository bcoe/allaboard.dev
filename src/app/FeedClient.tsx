"use client";

import { useState, useEffect, useCallback } from "react";
import { FeedActivity } from "@/lib/types";
import { getFeedActivities } from "@/lib/db";
import { useAuth } from "@/lib/auth-context";
import { timeAgo } from "@/lib/utils";
import GradeBadge from "@/components/GradeBadge";
import StarRating from "@/components/StarRating";
import UserAvatar from "@/components/UserAvatar";
import TickModal from "@/components/TickModal";

type FeedTab = "all" | "following";

export default function FeedClient() {
  const { user } = useAuth();
  const [tab, setTab] = useState<FeedTab>("all");
  const [activities, setActivities] = useState<FeedActivity[]>([]);
  const [tickTarget, setTickTarget] = useState<{ id: string; name: string } | null>(null);

  const reload = useCallback(() => {
    const userId = tab === "following" && user ? user.id : undefined;
    void (async () => {
      setActivities(await getFeedActivities(userId));
    })();
  }, [tab, user]);

  useEffect(reload, [reload]);

  // Reset to "all" if the user logs out while on the "following" tab
  useEffect(() => {
    if (!user && tab === "following") setTab("all");
  }, [user, tab]);

  return (
    <>
      {tickTarget && user && (
        <TickModal
          climbId={tickTarget.id}
          climbName={tickTarget.name}
          onClose={() => setTickTarget(null)}
          onSuccess={reload}
        />
      )}

      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-1">
          <TabButton active={tab === "all"} onClick={() => setTab("all")}>
            All Activity
          </TabButton>
          {user && (
            <TabButton active={tab === "following"} onClick={() => setTab("following")}>
              Following
            </TabButton>
          )}
        </div>
      </div>

      {activities.length === 0 ? (
        <p className="text-stone-500 text-center py-16">No activity yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {activities.map((activity) => (
            <ActivityCard
              key={activity.id}
              activity={activity}
              canTick={!!user}
              onTick={() => setTickTarget({ id: activity.climb.id, name: activity.climb.name })}
            />
          ))}
        </div>
      )}
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active
          ? "bg-stone-800 text-white"
          : "text-stone-400 hover:text-white hover:bg-stone-800"
      }`}
    >
      {children}
    </button>
  );
}

function ActivityCard({
  activity,
  canTick,
  onTick,
}: {
  activity: FeedActivity;
  canTick: boolean;
  onTick: () => void;
}) {
  const { user, climb, sent, rating, comment, date } = activity;
  return (
    <div className="bg-stone-800 border border-stone-700 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <UserAvatar user={user} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-semibold text-sm">{user.displayName}</span>
            <span className="text-stone-500 text-sm">@{user.handle}</span>
            <span className="text-stone-600 text-xs">·</span>
            <span className="text-stone-500 text-xs">{timeAgo(date)}</span>
          </div>

          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {sent ? (
              <span className="text-green-400 text-sm font-medium">Sent</span>
            ) : (
              <span className="text-stone-400 text-sm">Working</span>
            )}
            <span className="text-stone-500 text-sm">—</span>
            <span className="text-white text-sm font-medium">{climb.name}</span>
            <GradeBadge grade={climb.grade} />
            {climb.boardName && (
              <span className="text-stone-500 text-xs">{climb.boardName}</span>
            )}
          </div>

          <div className="mt-2 flex items-center gap-3">
            <StarRating value={Math.round(rating)} size="sm" />
            {climb.angle !== undefined && (
              <span className="text-xs text-stone-500">{climb.angle}°</span>
            )}
          </div>

          {comment && (
            <p className="mt-2 text-stone-300 text-sm leading-relaxed">{comment}</p>
          )}

          {canTick && (
            <button
              onClick={onTick}
              className="mt-3 text-xs text-orange-400 hover:text-orange-300 font-medium transition-colors"
            >
              Tick this climb →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
