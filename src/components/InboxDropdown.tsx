"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { InboxItem } from "@/lib/types";
import { getInbox, markInboxItemRead } from "@/lib/db";
import { useAuth } from "@/lib/auth-context";
import { timeAgo } from "@/lib/utils";
import UserAvatar from "./UserAvatar";

// Hex equivalents of GRADE_COLORS — mirrors user/[handle]/page.tsx
const GRADE_HEX: Record<string, string> = {
  V0:   "#15803d", V1:  "#16a34a", V2:  "#22c55e", V3:  "#84cc16",
  V4:   "#eab308", V5:  "#f59e0b", "V5+": "#d97706", V6:  "#f97316",
  V7:   "#ea580c", V8:  "#ef4444", "V8+": "#dc2626", V9:  "#b91c1c",
  V10:  "#991b1b", V11: "#be123c", V12: "#9333ea",  V13: "#7e22ce",
  V14:  "#db2777", V15: "#be185d", V16: "#86198f",  V17: "#4a044e",
  V18:  "#1c1917",
};

export default function InboxDropdown() {
  const { user } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadInbox = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { items, unreadCount } = await getInbox();
      setItems(items);
      setUnreadCount(unreadCount);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Poll unread count in the background
  useEffect(() => {
    if (!user) return;
    void loadInbox();
    const interval = setInterval(async () => {
      if (!open) {
        try {
          const { unreadCount } = await getInbox();
          setUnreadCount(unreadCount);
        } catch { /* ignore */ }
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, [user, open, loadInbox]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function handleToggle() {
    if (!open) await loadInbox();
    setOpen((o) => !o);
  }

  async function handleClick(item: InboxItem) {
    setOpen(false);
    if (!item.read) {
      await markInboxItemRead(item.id);
      setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, read: true } : i));
      setUnreadCount((n) => Math.max(0, n - 1));
    }

    if (item.type === "tick" && item.tick) {
      router.push(`/climbs/${item.tick.climbId}#tick-${item.tick.id}`);
    } else if (item.type === "comment" && item.comment && item.tick) {
      router.push(`/climbs/${item.tick.climbId}?openComments=${item.comment.tickId}#comment-${item.comment.id}`);
    }
  }

  if (!user) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleToggle}
        aria-label="Inbox"
        className="relative p-2 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-stone-900"
      >
        <InboxIcon />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-stone-800 border border-stone-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-700 flex items-center justify-between">
            <span className="text-white text-sm font-semibold">Inbox</span>
            {unreadCount > 0 && (
              <span className="text-xs text-stone-400">{unreadCount} unread</span>
            )}
          </div>

          <div className="max-h-[520px] overflow-y-auto">
            {loading ? (
              <p className="text-stone-500 text-sm text-center py-8">Loading…</p>
            ) : items.length === 0 ? (
              <p className="text-stone-500 text-sm text-center py-8">Nothing here yet.</p>
            ) : (
              items.map((item) => (
                <InboxRow key={item.id} item={item} onClick={() => handleClick(item)} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function InboxRow({ item, onClick }: { item: InboxItem; onClick: () => void }) {
  const actorAvatarUser = {
    id: item.actor.handle,
    handle: item.actor.handle,
    displayName: item.actor.displayName,
    avatarColor: item.actor.avatarColor,
    profilePictureUrl: item.actor.profilePictureUrl,
    bio: "", homeBoard: "", homeBoardAngle: 0, joinedAt: "",
    followersCount: 0, followingCount: 0, personalBests: {},
  };

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 hover:bg-stone-700 transition-colors border-b border-stone-700/50 last:border-0 ${
        !item.read ? "bg-stone-800" : "bg-stone-800/40"
      }`}
    >
      {/* Actor row */}
      <div className="flex items-center gap-2">
        <UserAvatar user={actorAvatarUser} size="sm" />
        <span className="text-white text-xs font-semibold flex-1 min-w-0 truncate">
          @{item.actor.handle}
        </span>
        <span className="text-stone-500 text-[11px] shrink-0">{timeAgo(item.createdAt)}</span>
        {!item.read && (
          <div className="shrink-0 w-2 h-2 rounded-full bg-orange-500" />
        )}
      </div>

      {/* Body */}
      {item.type === "tick" && item.tick ? (
        <TickCard tick={item.tick} />
      ) : item.type === "comment" && item.comment ? (
        <p className="mt-1.5 text-stone-300 text-xs leading-snug line-clamp-2 pl-7">
          {item.comment.body}
        </p>
      ) : null}
    </button>
  );
}

function TickCard({ tick }: { tick: NonNullable<InboxItem["tick"]> }) {
  const meta = [
    tick.boardName,
    tick.angle != null ? `${tick.angle}°` : null,
    tick.attempts != null ? `${tick.attempts} att.` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="mt-2 bg-stone-900 border border-stone-700 rounded-lg px-3 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="text-white text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
          style={{ background: GRADE_HEX[tick.grade] ?? "#78716c" }}
        >
          {tick.grade}
        </span>
        <span className="text-white text-xs font-semibold leading-snug min-w-0 truncate flex-1">
          {tick.climbName}
        </span>
        <span className={`text-[10px] font-semibold shrink-0 ${tick.sent ? "text-green-400" : "text-stone-400"}`}>
          {tick.sent ? "Sent" : "Working"}
        </span>
      </div>
      {meta && (
        <p className="text-stone-500 text-[10px] mt-1">{meta}</p>
      )}
    </div>
  );
}

function InboxIcon() {
  return (
    <svg className="w-[23px] h-[23px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}
