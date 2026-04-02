"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Board, Grade, User, UserTick } from "@/lib/types";
import {
  getUserById,
  getUserTicks,
  deleteTick,
  updateCurrentUser,
  getFollowers,
  getFollowing,
  checkFollowing,
  followUser,
  unfollowUser,
} from "@/lib/db";
import { useAuth } from "@/lib/auth-context";
import { ALL_GRADES, timeAgo } from "@/lib/utils";
import UserAvatar from "@/components/UserAvatar";
import GradeBadge from "@/components/GradeBadge";
import StarRating from "@/components/StarRating";
import TickModal from "@/components/TickModal";
import Link from "next/link";

type SocialTab = "ticks" | "followers" | "following";

export default function UserProfilePage() {
  const params = useParams<{ handle: string }>();
  const handle = params.handle;
  const { user: currentUser, updateUser } = useAuth();

  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [ticks, setTicks] = useState<UserTick[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [tickTarget, setTickTarget] = useState<{
    climbId: string;
    climbName: string;
    tick?: UserTick;
    tickId?: string;
  } | null>(null);

  const [activeTab, setActiveTab] = useState<SocialTab>("ticks");
  const [followers, setFollowers] = useState<User[]>([]);
  const [following, setFollowing] = useState<User[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);

  useEffect(() => {
    if (!handle) return;
    void getUserById(handle).then((u) => {
      if (!u) setNotFound(true);
      else setProfileUser(u);
    });
  }, [handle]);

  useEffect(() => {
    fetch("/api/boards")
      .then((r) => r.json())
      .then(setBoards)
      .catch(() => {});
  }, []);

  const reload = useCallback(() => {
    if (!handle) return;
    void getUserTicks(handle).then(setTicks);
  }, [handle]);

  useEffect(reload, [reload]);

  // Load followers/following and follow status
  useEffect(() => {
    if (!handle) return;
    void getFollowers(handle).then(setFollowers);
    void getFollowing(handle).then(setFollowing);
  }, [handle]);

  useEffect(() => {
    if (!handle || !currentUser) return;
    void checkFollowing(handle).then(setIsFollowing);
  }, [handle, currentUser]);

  if (notFound) {
    return <div className="text-center py-24 text-stone-500">User not found.</div>;
  }

  if (!profileUser) {
    return <div className="text-stone-500 text-center py-16">Loading…</div>;
  }

  const isOwn = currentUser?.id === profileUser.id;

  // Stats derived from tick list
  const sentTicks = ticks.filter((t) => t.sent);
  const hardestTickGrade: Grade | null = sentTicks.length > 0
    ? sentTicks.reduce((best, t) =>
        ALL_GRADES.indexOf(t.grade) > ALL_GRADES.indexOf(best.grade) ? t : best
      ).grade
    : null;

  // Hardest completed grade per board, from sent ticks
  const hardestByBoard: Record<string, Grade> = {};
  for (const tick of sentTicks) {
    if (!tick.boardName) continue;
    const current = hardestByBoard[tick.boardName];
    if (!current || ALL_GRADES.indexOf(tick.grade) > ALL_GRADES.indexOf(current)) {
      hardestByBoard[tick.boardName] = tick.grade;
    }
  }

  async function handleFollow() {
    if (!handle) return;
    setFollowLoading(true);
    try {
      if (isFollowing) {
        await unfollowUser(handle);
        setIsFollowing(false);
        setFollowers((prev) => prev.filter((u) => u.id !== currentUser?.id));
        setProfileUser((prev) => prev ? { ...prev, followersCount: prev.followersCount - 1 } : prev);
      } else {
        await followUser(handle);
        setIsFollowing(true);
        if (currentUser) {
          setFollowers((prev) => [currentUser as User, ...prev]);
        }
        setProfileUser((prev) => prev ? { ...prev, followersCount: prev.followersCount + 1 } : prev);
      }
    } finally {
      setFollowLoading(false);
    }
  }

  async function handleUnfollowFromList(targetHandle: string) {
    await unfollowUser(targetHandle);
    setFollowing((prev) => prev.filter((u) => u.handle !== targetHandle));
    setProfileUser((prev) => prev ? { ...prev, followingCount: prev.followingCount - 1 } : prev);
  }

  return (
    <div className="max-w-2xl mx-auto">
      {tickTarget && (
        <TickModal
          climbId={tickTarget.climbId}
          climbName={tickTarget.climbName}
          initialData={tickTarget.tick}
          tickId={tickTarget.tickId}
          onClose={() => setTickTarget(null)}
          onSuccess={reload}
        />
      )}

      {/* Header */}
      <div className="flex items-start gap-5">
        <UserAvatar user={profileUser} size="lg" />
        <div className="flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-white">{profileUser.displayName}</h1>
              <p className="text-stone-400 text-sm mt-0.5">@{profileUser.handle}</p>
            </div>
            {!isOwn && currentUser && (
              <button
                onClick={handleFollow}
                disabled={followLoading}
                className={`shrink-0 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                  isFollowing
                    ? "bg-stone-700 text-stone-300 hover:bg-stone-600 border border-stone-600"
                    : "bg-orange-500 text-white hover:bg-orange-400"
                }`}
              >
                {followLoading ? "…" : isFollowing ? "Unfollow" : "Follow"}
              </button>
            )}
          </div>
          {profileUser.bio && (
            <p className="text-stone-300 text-sm mt-2 leading-relaxed">{profileUser.bio}</p>
          )}
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {isOwn && boards.length > 0 ? (
              <>
                <span className="text-xs text-stone-500">Default board:</span>
                <select
                  value={boards.find((b) => b.name === profileUser.homeBoard)?.id ?? ""}
                  onChange={async (e) => {
                    const board = boards.find((b) => b.id === e.target.value);
                    if (!board) return;
                    const updated = await updateCurrentUser(profileUser.id, { homeBoard: board.name });
                    setProfileUser(updated);
                    if (isOwn) updateUser(updated);
                  }}
                  className="bg-stone-800 border border-stone-700 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-orange-500 transition-colors cursor-pointer"
                >
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </>
            ) : (
              <span className="text-xs text-stone-500">Home board: {profileUser.homeBoard}</span>
            )}
            <span className="text-xs text-stone-600">·</span>
            <span className="text-xs text-stone-500">
              Joined {new Date(profileUser.joinedAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </span>
          </div>
        </div>
      </div>

      {/* Aggregate stat tiles */}
      <div className="grid grid-cols-3 gap-3 mt-8">
        <Tile value={ticks.length} label="Total Ticks" />
        <div className="bg-stone-800 border border-stone-700 rounded-xl px-4 py-3 text-center">
          {hardestTickGrade ? (
            <>
              <div className="flex justify-center mb-1">
                <GradeBadge grade={hardestTickGrade} size="md" />
              </div>
              <div className="text-stone-400 text-xs mt-0.5">Hardest Tick</div>
            </>
          ) : (
            <>
              <div className="text-2xl font-bold text-stone-600">—</div>
              <div className="text-stone-400 text-xs mt-0.5">Hardest Tick</div>
            </>
          )}
        </div>
        <Tile value={profileUser.followersCount} label="Followers" />
      </div>

      {/* Hardest completed grade per board type */}
      {Object.keys(hardestByBoard).length > 0 && (
        <section className="mt-8">
          <h2 className="text-orange-400 font-semibold text-lg mb-3">Hardest Completed</h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(hardestByBoard).map(([board, grade]) => (
              <div
                key={board}
                className="bg-stone-800 border border-stone-700 rounded-lg px-4 py-3 flex items-center gap-3"
              >
                <span className="text-stone-400 text-sm">{board}</span>
                <GradeBadge grade={grade} size="md" />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Detailed stats link — own profile only */}
      {isOwn && (
        <section className="mt-8">
          <Link
            href="/stats"
            className="flex items-center justify-between bg-stone-800 border border-stone-700 hover:border-stone-500 rounded-xl px-5 py-4 transition-colors"
          >
            <div>
              <div className="text-white font-semibold">Detailed Stats</div>
              <div className="text-stone-400 text-sm mt-0.5">
                Grade pyramid, session frequency, progress over time
              </div>
            </div>
            <span className="text-stone-400 text-lg">→</span>
          </Link>
        </section>
      )}

      {/* Tab nav */}
      <div className="mt-8 flex gap-1 border-b border-stone-800">
        {(["ticks", "followers", "following"] as SocialTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-orange-500 text-orange-400"
                : "border-transparent text-stone-500 hover:text-stone-300"
            }`}
          >
            {tab === "ticks"
              ? `Ticks (${ticks.length})`
              : tab === "followers"
              ? `Followers (${profileUser.followersCount})`
              : `Following (${profileUser.followingCount})`}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <section className="mt-4 pb-8">
        {activeTab === "ticks" && (
          ticks.length === 0 ? (
            <p className="text-stone-500 text-sm">No ticks yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {ticks.map((tick) => (
                <TickCard
                  key={tick.id}
                  tick={tick}
                  canEdit={isOwn}
                  onEdit={() =>
                    setTickTarget({ climbId: tick.climbId, climbName: tick.climbName, tick, tickId: tick.id })
                  }
                  onDelete={async () => {
                    await deleteTick(tick.id);
                    reload();
                  }}
                />
              ))}
            </div>
          )
        )}

        {activeTab === "followers" && (
          followers.length === 0 ? (
            <p className="text-stone-500 text-sm">No followers yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {followers.map((u) => (
                <UserRow key={u.id} user={u} />
              ))}
            </div>
          )
        )}

        {activeTab === "following" && (
          following.length === 0 ? (
            <p className="text-stone-500 text-sm">Not following anyone yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {following.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  action={isOwn ? (
                    <button
                      onClick={() => handleUnfollowFromList(u.handle)}
                      className="text-xs text-stone-500 hover:text-red-400 transition-colors"
                    >
                      Unfollow
                    </button>
                  ) : undefined}
                />
              ))}
            </div>
          )
        )}
      </section>

      {/* API token — own profile only, placed last as a developer/power-user feature */}
      {isOwn && profileUser.apiToken && (
        <section className="mt-8 pb-8">
          <h2 className="text-orange-400 font-semibold text-lg mb-3">API Token</h2>
          <div className="bg-stone-800 border border-stone-700 rounded-xl p-4 space-y-3">
            <p className="text-amber-400 text-xs leading-relaxed">
              ⚠ Do not share your API token — it grants full access to your account.
              Use it to authenticate API requests via the <code className="font-mono bg-stone-700 px-1 rounded">token=</code> query parameter.
            </p>
            <div className="flex items-center gap-2">
              <input
                type={showToken ? "text" : "password"}
                value={profileUser.apiToken}
                readOnly
                className="flex-1 min-w-0 bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm font-mono text-stone-300 focus:outline-none select-all"
              />
              <button
                onClick={() => setShowToken((v) => !v)}
                className="shrink-0 px-3 py-2 bg-stone-700 hover:bg-stone-600 text-stone-300 text-xs rounded-lg transition-colors"
              >
                {showToken ? "Hide" : "Show"}
              </button>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(profileUser.apiToken!);
                  setTokenCopied(true);
                  setTimeout(() => setTokenCopied(false), 2000);
                }}
                className="shrink-0 px-3 py-2 bg-orange-500 hover:bg-orange-400 text-white text-xs rounded-lg transition-colors"
              >
                {tokenCopied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-stone-500 text-xs">
              View the{" "}
              <a href="/docs/" target="_blank" rel="noreferrer" className="text-orange-400 hover:text-orange-300 underline">
                API documentation
              </a>{" "}
              for available endpoints and usage examples.
            </p>
          </div>
        </section>
      )}
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

function UserRow({ user, action }: { user: User; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-stone-800 border border-stone-700 rounded-xl px-4 py-3">
      <Link href={`/user/${user.handle}`} className="flex items-center gap-3 min-w-0 group">
        <UserAvatar user={user} size="sm" />
        <div className="min-w-0">
          <div className="text-white text-sm font-medium group-hover:text-orange-400 transition-colors truncate">
            {user.displayName}
          </div>
          <div className="text-stone-500 text-xs">@{user.handle}</div>
        </div>
      </Link>
      {action}
    </div>
  );
}

function TickCard({
  tick,
  canEdit,
  onEdit,
  onDelete,
}: {
  tick: UserTick;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(`Delete your tick for "${tick.climbName}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  }

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
              <span className="text-stone-500 text-xs">
                {tick.boardName} · {tick.angle}°
              </span>
            )}
            {tick.attempts != null && (
              <span className="text-stone-500 text-xs">
                {tick.attempts} {tick.attempts === 1 ? "attempt" : "attempts"}
              </span>
            )}
            <span className="text-stone-600 text-xs">{timeAgo(tick.date)}</span>
          </div>
          {tick.comment && (
            <p className="mt-2 text-stone-400 text-sm leading-relaxed">{tick.comment}</p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0 mt-0.5">
          <Link
            href={`/climbs/${tick.climbId}`}
            className="text-xs text-stone-500 hover:text-white transition-colors"
          >
            View
          </Link>
          {canEdit && (
            <>
              <button
                onClick={onEdit}
                className="text-xs text-stone-500 hover:text-orange-400 transition-colors"
                title="Edit tick"
              >
                Edit
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-xs text-stone-600 hover:text-red-400 transition-colors disabled:opacity-40"
                title="Delete tick"
              >
                {deleting ? "…" : "Delete"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
