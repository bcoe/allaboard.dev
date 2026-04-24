"use client";

import { useState, useEffect, useCallback } from "react";
import { FeedActivity } from "@/lib/types";
import { getFeedActivities } from "@/lib/db";
import { useAuth } from "@/lib/auth-context";
import { timeAgo } from "@/lib/utils";
import GradeBadge from "@/components/GradeBadge";
import StarRating from "@/components/StarRating";
import UserAvatar from "@/components/UserAvatar";
import CommentSection from "@/components/CommentSection";
import Link from "next/link";

const PAGE_SIZE = 25;

type FeedTab = "all" | "following";

export default function FeedClient() {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab]             = useState<FeedTab>("following");
  const [activities, setActivities] = useState<FeedActivity[]>([]);
  const [hasMore, setHasMore]     = useState(false);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(true);

  const fetchPage = useCallback(async (tab: FeedTab, page: number) => {
    setLoading(true);
    try {
      const followingOf = tab === "following" && user ? user.id : undefined;
      const { activities, hasMore } = await getFeedActivities(followingOf, {
        limit:  PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      setActivities(activities);
      setHasMore(hasMore);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Reload when tab or page changes — but wait for auth to resolve first.
  useEffect(() => {
    if (authLoading) return;
    void fetchPage(tab, page);
  }, [tab, page, fetchPage, authLoading]);

  // Reset to page 1 when the tab changes.
  function switchTab(next: FeedTab) {
    setTab(next);
    setPage(1);
  }

  // Reset to "all" if the user logs out while on the "following" tab.
  useEffect(() => {
    if (!authLoading && !user && tab === "following") switchTab("all");
  }, [authLoading, user, tab]);

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-1">
          <TabButton active={tab === "all"} onClick={() => switchTab("all")}>
            All Activity
          </TabButton>
          {user && (
            <TabButton active={tab === "following"} onClick={() => switchTab("following")}>
              Following
            </TabButton>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-stone-500 text-center py-16">Loading…</p>
      ) : activities.length === 0 ? (
        <p className="text-stone-500 text-center py-16">No activity yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {activities.map((activity) => (
            <ActivityCard key={activity.id} activity={activity} />
          ))}
        </div>
      )}

      {!loading && (page > 1 || hasMore) && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            onClick={() => setPage((p) => p - 1)}
            disabled={page === 1}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-stone-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Previous page"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10 3L5 8l5 5" />
            </svg>
            Prev
          </button>
          <span className="text-stone-500 text-sm">{page}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-stone-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Next page"
          >
            Next
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 3l5 5-5 5" />
            </svg>
          </button>
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

// Instagram icon path
const INSTAGRAM_PATH =
  "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z";

function ActivityCard({ activity }: { activity: FeedActivity }) {
  const { user, climb, sent, rating, attempts, comment, date, instagramUrl } = activity;
  const [commentsOpen, setCommentsOpen] = useState(false);
  // Stays true once set — keeps CommentSection mounted so it never re-fetches on re-open.
  const [commentsLoaded, setCommentsLoaded] = useState(false);

  function handleToggleComments() {
    if (!commentsOpen) setCommentsLoaded(true);
    setCommentsOpen((o) => !o);
  }

  return (
    <div id={`tick-${activity.id}`} className="bg-stone-800 border border-stone-700 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <Link href={`/user/${user.handle}`}>
          <UserAvatar user={user} size="md" />
        </Link>
        <div className="flex-1 min-w-0">

          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/user/${user.handle}`} className="text-white font-semibold text-sm hover:text-orange-400 transition-colors">@{user.handle}</Link>
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
            <Link href={`/climbs/${climb.id}`} className="text-white text-sm font-medium hover:text-orange-400 transition-colors">{climb.name}</Link>
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
            <span className="text-xs text-stone-500">
              {attempts != null ? `${attempts} ${attempts === 1 ? "attempt" : "attempts"}` : "a bunch of attempts"}
            </span>
          </div>

          {comment && (
            <p className="mt-2 text-stone-300 text-sm leading-relaxed">{comment}</p>
          )}

          {instagramUrl && (
            <div className="mt-3">
              <a
                href={instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-white transition-colors group"
              >
                <div className="w-5 h-5 rounded bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400 flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d={INSTAGRAM_PATH} />
                  </svg>
                </div>
                Watch video
              </a>
            </div>
          )}

          {/* Comment toggle */}
          <div className="mt-3">
            <button
              onClick={handleToggleComments}
              className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors"
            >
              <ReplyIcon />
              {commentsOpen
                ? "Hide comments"
                : activity.commentsCount > 0
                  ? `${activity.commentsCount} ${activity.commentsCount === 1 ? "comment" : "comments"}`
                  : "Comments"}
            </button>
          </div>

          {/* Mount on first open, then keep mounted — hidden prevents re-fetch on re-open */}
          {commentsLoaded && (
            <div className={commentsOpen ? "" : "hidden"}>
              <CommentSection tickId={activity.id} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReplyIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
