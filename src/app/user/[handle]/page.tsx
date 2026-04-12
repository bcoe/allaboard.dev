"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  importAuroraData,
  importMoonboardData,
  recalculateBoardDifficulty,
  type AuroraImportResult,
  type MoonboardImportResult,
  type BoardDifficultyResult,
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
  const [page, setPage] = useState(1);
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
              <h1 className="text-2xl font-bold text-white">@{profileUser.handle}</h1>
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
                <BoardDropdown
                  boards={boards}
                  value={boards.find((b) => b.name === profileUser.homeBoard)?.id ?? ""}
                  onChange={async (boardId) => {
                    const board = boards.find((b) => b.id === boardId);
                    if (!board) return;
                    const updated = await updateCurrentUser(profileUser.id, { homeBoard: board.name });
                    setProfileUser(updated);
                    updateUser(updated);
                  }}
                />
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

      {/* Detailed stats link — visible to everyone */}
      <section className="mt-8">
          <Link
            href={`/user/${profileUser.handle}/stats`}
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

      {/* Tab nav */}
      <div className="mt-8 flex gap-1 border-b border-stone-800">
        {(["ticks", "followers", "following"] as SocialTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setPage(1); }}
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
        {activeTab === "ticks" && (() => {
          const PAGE_SIZE = 10;
          const pageItems = ticks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
          const totalPages = Math.ceil(ticks.length / PAGE_SIZE);
          return ticks.length === 0 ? (
            <p className="text-stone-500 text-sm">No ticks yet.</p>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                {pageItems.map((tick) => (
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
              {totalPages > 1 && (
                <Pagination page={page} totalPages={totalPages} onChange={setPage} />
              )}
            </>
          );
        })()}

        {activeTab === "followers" && (() => {
          const PAGE_SIZE = 10;
          const pageItems = followers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
          const totalPages = Math.ceil(followers.length / PAGE_SIZE);
          return followers.length === 0 ? (
            <p className="text-stone-500 text-sm">No followers yet.</p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {pageItems.map((u) => (
                  <UserRow key={u.id} user={u} />
                ))}
              </div>
              {totalPages > 1 && (
                <Pagination page={page} totalPages={totalPages} onChange={setPage} />
              )}
            </>
          );
        })()}

        {activeTab === "following" && (() => {
          const PAGE_SIZE = 10;
          const pageItems = following.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
          const totalPages = Math.ceil(following.length / PAGE_SIZE);
          return following.length === 0 ? (
            <p className="text-stone-500 text-sm">Not following anyone yet.</p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {pageItems.map((u) => (
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
              {totalPages > 1 && (
                <Pagination page={page} totalPages={totalPages} onChange={setPage} />
              )}
            </>
          );
        })()}
      </section>

      {/* Import Data — own profile only */}
      {isOwn && (
        <ImportSection handle={profileUser.handle} onSuccess={reload} />
      )}

      {/* Moonboard export — own profile only */}
      {isOwn && <MoonboardExportSection />}

      {/* Board difficulty — admin only (bc viewing their own profile) */}
      {isOwn && handle === "bc" && <BoardDifficultySection />}

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
              <a href="/api-docs" className="text-orange-400 hover:text-orange-300 underline">
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

function BoardDropdown({
  boards,
  value,
  onChange,
}: {
  boards: Board[];
  value: string;
  onChange: (boardId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selected = boards.find((b) => b.id === value);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 bg-stone-800 border border-stone-700 hover:border-stone-500 rounded-lg px-3 py-1.5 text-xs text-stone-300 transition-colors"
      >
        <span className="truncate max-w-40">{selected?.name ?? "Select board"}</span>
        <svg
          className={`w-3 h-3 text-stone-500 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5"
        >
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-stone-800 border border-stone-700 rounded-lg shadow-2xl z-20 min-w-48 py-1">
          {boards.map((b) => (
            <label
              key={b.id}
              className="flex items-center gap-2.5 px-3 py-2 hover:bg-stone-700/60 cursor-pointer select-none"
            >
              <input
                type="radio"
                name="home-board"
                checked={b.id === value}
                onChange={() => { onChange(b.id); setOpen(false); }}
                className="accent-orange-500 w-3.5 h-3.5"
              />
              <span className="text-sm text-stone-300">{b.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-3 mt-5">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page === 1}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-stone-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Previous page"
      >
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M10 3L5 8l5 5" />
        </svg>
        Prev
      </button>
      <span className="text-stone-500 text-sm">
        {page} / {totalPages}
      </span>
      <button
        onClick={() => onChange(page + 1)}
        disabled={page === totalPages}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-stone-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Next page"
      >
        Next
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M6 3l5 5-5 5" />
        </svg>
      </button>
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
            <Link href={`/climbs/${tick.climbId}`} className="text-white font-semibold text-sm truncate hover:text-orange-400 transition-colors">{tick.climbName}</Link>
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

function ImportSection({
  handle,
  onSuccess,
}: {
  handle: string;
  onSuccess: () => void;
}) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<AuroraImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mbImporting, setMbImporting] = useState(false);
  const [mbResult, setMbResult] = useState<MoonboardImportResult | null>(null);
  const [mbError, setMbError] = useState<string | null>(null);
  const mbFileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setResult(null);
    setError(null);
    setImporting(true);

    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setError("Could not parse file — make sure it is valid JSON.");
        return;
      }

      const res = await importAuroraData(handle, parsed);
      setResult(res);
      onSuccess();
    } catch {
      setError("Import failed. Please try again.");
    } finally {
      setImporting(false);
      // Reset so the same file can be re-selected after fixing an error
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleMoonboardFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setMbResult(null);
    setMbError(null);
    setMbImporting(true);

    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setMbError("Could not parse file — make sure it is valid JSON.");
        return;
      }

      const res = await importMoonboardData(handle, parsed);
      setMbResult(res);
      onSuccess();
    } catch {
      setMbError("Import failed. Please try again.");
    } finally {
      setMbImporting(false);
      if (mbFileInputRef.current) mbFileInputRef.current.value = "";
    }
  }

  return (
    <section className="mt-8 pb-2">
      <h2 className="text-orange-400 font-semibold text-lg mb-3">Import Data</h2>
      <div className="bg-stone-800 border border-stone-700 rounded-xl p-4 space-y-3">
        <div>
          <p className="text-stone-300 text-sm font-medium">Upload Aurora Kilter Data</p>
          <p className="text-stone-400 text-xs mt-1 leading-relaxed">
            Upload your personal data export from the Aurora application to import
            your ticks and climbs. New climbs will be created on the Kilter Board
            (Original) if they don&apos;t already exist.
          </p>
        </div>

        <label className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
          importing
            ? "bg-stone-700 text-stone-500 cursor-not-allowed"
            : "bg-orange-500 hover:bg-orange-400 text-white"
        }`}>
          {importing ? "Importing…" : "Choose JSON file"}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            disabled={importing}
            onChange={handleFile}
          />
        </label>

        {result && (
          <div className="bg-stone-900 border border-stone-700 rounded-lg px-4 py-3 text-sm">
            <p className="text-green-400 font-medium mb-2">Import complete</p>
            <dl className="space-y-1">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-stone-400">Ticks added</dt>
                <dd className="text-white font-semibold">{result.imported}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-stone-400">Climbs created</dt>
                <dd className="text-white font-semibold">{result.climbsCreated}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-stone-400">Ticks skipped</dt>
                <dd className="text-stone-500">{result.skipped}</dd>
              </div>
              {result.skipped > 0 && (
                <div className="pt-1 mt-1 border-t border-stone-800 space-y-1">
                  {result.skipDetails.alreadyImported > 0 && (
                    <div className="flex items-center justify-between gap-4 pl-3">
                      <dt className="text-stone-500 text-xs">Already imported (same climb, same day)</dt>
                      <dd className="text-stone-500 text-xs">{result.skipDetails.alreadyImported}</dd>
                    </div>
                  )}
                  {result.skipDetails.unknownGrade > 0 && (
                    <div className="flex items-center justify-between gap-4 pl-3">
                      <dt className="text-stone-500 text-xs">Unrecognised Font grade</dt>
                      <dd className="text-stone-500 text-xs">{result.skipDetails.unknownGrade}</dd>
                    </div>
                  )}
                  {result.skipDetails.missingName > 0 && (
                    <div className="flex items-center justify-between gap-4 pl-3">
                      <dt className="text-stone-500 text-xs">Missing climb name</dt>
                      <dd className="text-stone-500 text-xs">{result.skipDetails.missingName}</dd>
                    </div>
                  )}
                  {result.skipDetails.invalidAngle > 0 && (
                    <div className="flex items-center justify-between gap-4 pl-3">
                      <dt className="text-stone-500 text-xs">Invalid angle</dt>
                      <dd className="text-stone-500 text-xs">{result.skipDetails.invalidAngle}</dd>
                    </div>
                  )}
                </div>
              )}
            </dl>
          </div>
        )}

        {error && (
          <p className="text-red-400 text-sm">{error}</p>
        )}
      </div>

      <div className="bg-stone-800 border border-stone-700 rounded-xl p-4 space-y-3 mt-3">
        <div>
          <p className="text-stone-300 text-sm font-medium">Upload Moonboard Data</p>
          <p className="text-stone-400 text-xs mt-1 leading-relaxed">
            Upload the JSON file you exported from moonboard.com using the snippet above
            to import your ticks. New climbs will be created on Moonboard 2016 at 40°
            if they don&apos;t already exist.
          </p>
        </div>

        <label className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
          mbImporting
            ? "bg-stone-700 text-stone-500 cursor-not-allowed"
            : "bg-orange-500 hover:bg-orange-400 text-white"
        }`}>
          {mbImporting ? "Importing…" : "Choose JSON file"}
          <input
            ref={mbFileInputRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            disabled={mbImporting}
            onChange={handleMoonboardFile}
          />
        </label>

        {mbResult && (
          <div className="bg-stone-900 border border-stone-700 rounded-lg px-4 py-3 text-sm">
            <p className="text-green-400 font-medium mb-2">Import complete</p>
            <dl className="space-y-1">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-stone-400">Ticks added</dt>
                <dd className="text-white font-semibold">{mbResult.imported}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-stone-400">Climbs created</dt>
                <dd className="text-white font-semibold">{mbResult.climbsCreated}</dd>
              </div>
              {mbResult.boardsCreated > 0 && (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-stone-400">Boards created</dt>
                  <dd className="text-white font-semibold">{mbResult.boardsCreated}</dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-4">
                <dt className="text-stone-400">Ticks skipped</dt>
                <dd className="text-stone-500">{mbResult.skipped}</dd>
              </div>
              {mbResult.skipped > 0 && (
                <div className="pt-1 mt-1 border-t border-stone-800 space-y-1">
                  {mbResult.skipDetails.alreadyImported > 0 && (
                    <div className="flex items-center justify-between gap-4 pl-3">
                      <dt className="text-stone-500 text-xs">Already imported (same climb, same day)</dt>
                      <dd className="text-stone-500 text-xs">{mbResult.skipDetails.alreadyImported}</dd>
                    </div>
                  )}
                  {mbResult.skipDetails.unknownGrade > 0 && (
                    <div className="flex items-center justify-between gap-4 pl-3">
                      <dt className="text-stone-500 text-xs">Unrecognised Font grade</dt>
                      <dd className="text-stone-500 text-xs">{mbResult.skipDetails.unknownGrade}</dd>
                    </div>
                  )}
                  {mbResult.skipDetails.missingName > 0 && (
                    <div className="flex items-center justify-between gap-4 pl-3">
                      <dt className="text-stone-500 text-xs">Missing climb name</dt>
                      <dd className="text-stone-500 text-xs">{mbResult.skipDetails.missingName}</dd>
                    </div>
                  )}
                  {mbResult.skipDetails.notSent > 0 && (
                    <div className="flex items-center justify-between gap-4 pl-3">
                      <dt className="text-stone-500 text-xs">Projects (not sent)</dt>
                      <dd className="text-stone-500 text-xs">{mbResult.skipDetails.notSent}</dd>
                    </div>
                  )}
                </div>
              )}
            </dl>
          </div>
        )}

        {mbError && (
          <p className="text-red-400 text-sm">{mbError}</p>
        )}
      </div>
    </section>
  );
}

// ─── Moonboard export ─────────────────────────────────────────────────────────

const MOONBOARD_OPTIONS = [
  { label: "Moonboard 2016 @ 40 degrees", filter: "setupId~eq~'1'~and~Configuration~eq~3" },
] as const;

function MoonboardExportSection() {
  const [selectedFilter, setSelectedFilter] = useState<string>(MOONBOARD_OPTIONS[0].filter);
  const [copied, setCopied] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  const snippet = `const filter = "${selectedFilter}";

// Step 1: fetch the list of sessions.
const logbook = await fetch("https://www.moonboard.com/Logbook/GetLogbook", {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    "x-requested-with": "XMLHttpRequest",
  },
  body: \`sort=&page=1&pageSize=4000&group=&filter=\${encodeURIComponent(filter)}\`,
  credentials: "include",
}).then(r => r.json());

// Step 2: fetch the climbs for each session, 3 at a time.
const ids = (logbook.Data ?? []).map(entry => entry.Id);
const entries = [];
for (let i = 0; i < ids.length; i += 3) {
  const batch = ids.slice(i, i + 3).map(id =>
    fetch(\`https://www.moonboard.com/Logbook/GetLogbookEntries/\${id}\`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
      },
      body: \`sort=&page=1&pageSize=30&group=&filter=\${encodeURIComponent(filter)}\`,
      credentials: "include",
    }).then(r => r.json()).then(data => ({ id, data }))
  );
  entries.push(...await Promise.all(batch));
  console.log(\`Fetched \${Math.min(i + 3, ids.length)} / \${ids.length} sessions\`);
}

// Step 3: download as JSON.
const blob = new Blob([JSON.stringify({ logbook, entries }, null, 2)], { type: "application/json" });
const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "my-climbs.json" });
a.click();`

  function copySnippet() {
    void navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="mt-8 pb-2">
      <h2 className="text-orange-400 font-semibold text-lg mb-3">Export Moonboard Data</h2>
      <div className="bg-stone-800 border border-stone-700 rounded-xl p-4 space-y-4">
        <p className="text-stone-400 text-xs leading-relaxed">
          Export your Moonboard benchmarks as JSON so you can import them into Allaboard.
        </p>

        {/* Board selector */}
        <div>
          <label className="text-stone-300 text-sm font-medium block mb-1.5">Board</label>
          <select
            value={selectedFilter}
            onChange={(e) => setSelectedFilter(e.target.value)}
            className="bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 transition-colors"
          >
            {MOONBOARD_OPTIONS.map((opt) => (
              <option key={opt.filter} value={opt.filter}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Instructions toggle */}
        <button
          onClick={() => setShowInstructions((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors"
        >
          <svg
            className={`w-3 h-3 shrink-0 transition-transform ${showInstructions ? "rotate-90" : ""}`}
            viewBox="0 0 10 10" fill="currentColor"
          >
            <path d="M3 2l4 3-4 3V2z" />
          </svg>
          {showInstructions ? "Hide instructions" : "Show instructions"}
        </button>

        {showInstructions && (
          <>
            <ol className="space-y-1.5 text-stone-400 text-sm list-decimal list-inside">
              <li>
                Visit{" "}
                <a
                  href="https://www.moonboard.com/account/login"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-orange-400 hover:text-orange-300 underline"
                >
                  moonboard.com/account/login
                </a>{" "}
                and log in to your account.
              </li>
              <li>Copy the snippet below after selecting your board type.</li>
              <li>On moonboard.com, right-click anywhere on the page and choose <strong>Inspect</strong>. Click the <strong>Console</strong> tab at the top of the panel that opens. Paste the script into the input at the bottom and press Enter.</li>
            </ol>

            {/* Snippet */}
            <div className="relative">
              <pre className="bg-stone-900 border border-stone-700 rounded-lg p-4 text-xs text-stone-300 font-mono overflow-x-auto whitespace-pre leading-relaxed">
                {snippet}
              </pre>
              <button
                onClick={copySnippet}
                className="absolute top-3 right-3 px-3 py-1.5 bg-stone-700 hover:bg-stone-600 text-stone-300 text-xs rounded-lg transition-colors"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// ─── Board difficulty (admin only) ───────────────────────────────────────────

function BoardDifficultySection() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BoardDifficultyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRecalculate() {
    if (
      !confirm(
        "Recalculate board relative difficulty scores?\n\n" +
          "This will overwrite the current values for all boards that have qualifying data.",
      )
    ) return;

    setRunning(true);
    setResult(null);
    setError(null);

    try {
      const res = await recalculateBoardDifficulty();
      setResult(res);
    } catch {
      setError("Calculation failed. Check the server console for details.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="mt-8 pb-8">
      <h2 className="text-orange-400 font-semibold text-lg mb-3">Board Difficulty</h2>
      <div className="bg-stone-800 border border-stone-700 rounded-xl p-4 space-y-3">
        <p className="text-stone-400 text-xs leading-relaxed">
          Recalculates the <code className="font-mono bg-stone-700 px-1 rounded">relative_difficulty</code>{" "}
          score for every board using logistic regression fitted per climber. Each attempt is one
          Bernoulli trial:{" "}
          <code className="font-mono bg-stone-700 px-1 rounded">
            logit(P(send)) = β₀ + β_grade · grade + Σ β_board · board_indicator
          </code>. Board coefficients capture difficulty controlling for grade — a more-negative
          coefficient means harder. Only climbers with ≥{5} sessions on ≥{2} boards contribute.
          Scores are normalised per climber, averaged across climbers, and stored on a x1.0–x2.0
          scale (x1.0 = easiest, x2.0 = hardest).
        </p>

        <button
          onClick={() => void handleRecalculate()}
          disabled={running}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            running
              ? "bg-stone-700 text-stone-500 cursor-not-allowed"
              : "bg-orange-500 hover:bg-orange-400 text-white"
          }`}
        >
          {running ? "Calculating…" : "Recalculate Board Difficulty"}
        </button>

        {result && (
          <div className="bg-stone-900 border border-stone-700 rounded-lg px-4 py-3 space-y-3">
            <p className="text-green-400 font-medium text-sm">Calculation complete</p>

            {Object.keys(result.boardScores).length > 0 ? (
              <dl className="space-y-1">
                {Object.entries(result.boardScores).map(([id, score]) => (
                  <div key={id} className="flex items-center justify-between gap-4">
                    <dt className="text-stone-400 text-xs truncate">{id}</dt>
                    <dd className="text-white text-xs font-mono shrink-0">{score.toFixed(4)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-stone-500 text-xs">No boards updated (insufficient data).</p>
            )}

            <details>
              <summary className="text-stone-500 text-xs cursor-pointer hover:text-stone-300 transition-colors select-none">
                View detailed log ({result.lines.length} lines)
              </summary>
              <pre className="mt-2 bg-stone-950 border border-stone-800 rounded p-3 text-xs text-stone-400 font-mono overflow-x-auto whitespace-pre leading-relaxed max-h-96 overflow-y-auto">
                {result.lines.join("\n")}
              </pre>
            </details>
          </div>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>
    </section>
  );
}
