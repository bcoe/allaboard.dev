"use client";

import { useState, useEffect, useCallback } from "react";
import { FeedActivity } from "@/lib/types";
import { getFeedActivities } from "@/lib/db";
import { timeAgo } from "@/lib/utils";
import GradeBadge from "@/components/GradeBadge";
import UserAvatar from "@/components/UserAvatar";
import LogClimbModal from "@/components/LogClimbModal";

export default function FeedClient() {
  const [activities, setActivities] = useState<FeedActivity[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  const reload = useCallback(() => {
    void (async () => {
      setActivities(await getFeedActivities());
    })();
  }, []);

  useEffect(reload, [reload]);

  return (
    <>
      {modalOpen && (
        <LogClimbModal onClose={() => setModalOpen(false)} onLogged={reload} />
      )}

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Following</h1>
          <p className="text-stone-400 mt-1">Recent activity from people you follow</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="bg-orange-500 hover:bg-orange-400 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
        >
          + Log Climb
        </button>
      </div>

      {activities.length === 0 ? (
        <p className="text-stone-500 text-center py-16">No activity yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {activities.map((activity) => (
            <ActivityCard key={activity.id} activity={activity} />
          ))}
        </div>
      )}
    </>
  );
}

function ActivityCard({ activity }: { activity: FeedActivity }) {
  const { user, climb, sent, attempts, notes, date } = activity;
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
            <span className="text-stone-500 text-xs">{climb.boardType}</span>
          </div>

          {notes && (
            <p className="mt-2 text-stone-300 text-sm leading-relaxed">{notes}</p>
          )}

          <div className="mt-2 text-xs text-stone-500">
            {attempts} {attempts === 1 ? "attempt" : "attempts"}
            {climb.angle !== undefined && ` · ${climb.angle}°`}
          </div>
        </div>
      </div>
    </div>
  );
}
