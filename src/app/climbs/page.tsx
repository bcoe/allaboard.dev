"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Grade, Board } from "@/lib/types";
import { ALL_GRADES } from "@/lib/utils";
import { getClimbs, ClimbFilters } from "@/lib/db";
import { useAuth } from "@/lib/auth-context";
import ClimbCard from "@/components/ClimbCard";
import TickModal from "@/components/TickModal";
import Link from "next/link";
import type { Climb } from "@/lib/types";

const PAGE_SIZE   = 25;
const DEFAULT_SORT = "sends_desc";

// ── Inner page (needs Suspense because it calls useSearchParams) ───────────────

function ClimbsPageInner() {
  const { user } = useAuth();
  const router       = useRouter();
  const searchParams = useSearchParams();

  // ── URL is the source of truth for all filter state ──────────────────────────
  const urlQuery  = searchParams.get("q") ?? "";
  const gradeMin  = (searchParams.get("gradeMin") as Grade) || null;
  const gradeMax  = (searchParams.get("gradeMax") as Grade) || null;
  const boardIds  = searchParams.get("boards")?.split(",").filter(Boolean) ?? [];
  const angleMin  = searchParams.get("angleMin") ?? "";
  const angleMax  = searchParams.get("angleMax") ?? "";
  const sort      = searchParams.get("sort") ?? DEFAULT_SORT;
  const page      = Number(searchParams.get("page") ?? "1");

  // ── Non-filter UI state ───────────────────────────────────────────────────────
  const [climbs, setClimbs]           = useState<Climb[]>([]);
  const [boards, setBoards]           = useState<Board[]>([]);
  const [tickTarget, setTickTarget]   = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading]         = useState(true);
  const [hasMore, setHasMore]         = useState(false);
  const [total, setTotal]             = useState(0);
  const [boardsLoaded, setBoardsLoaded] = useState(false);

  // Local search input value — debounced before writing to URL
  const [inputValue, setInputValue]   = useState(urlQuery);
  const debounceRef                   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const defaultApplied                = useRef(false);

  // Dropdown open state
  const [sortOpen, setSortOpen]   = useState(false);
  const [gradeOpen, setGradeOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [angleOpen, setAngleOpen] = useState(false);

  const sortRef  = useRef<HTMLDivElement>(null);
  const gradeRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const angleRef = useRef<HTMLDivElement>(null);

  // ── URL update helper ─────────────────────────────────────────────────────────
  function updateParams(
    updates: Record<string, string | null>,
    resetPage = true,
  ) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    if (resetPage) params.delete("page");
    // Keep URL clean: omit default sort and page=1
    if (params.get("sort") === DEFAULT_SORT) params.delete("sort");
    if (params.get("page") === "1")          params.delete("page");
    const qs = params.toString();
    router.replace(`/climbs${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  // ── Sync search input when URL changes (browser back/forward) ─────────────────
  useEffect(() => {
    setInputValue(urlQuery);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQuery]);

  // ── Load boards; apply home board default on first visit ──────────────────────
  useEffect(() => {
    fetch("/api/boards")
      .then((r) => r.json())
      .then((loaded: Board[]) => {
        setBoards(loaded);
        // Only apply default when the URL has no boards param (first/clean visit)
        if (!defaultApplied.current && !searchParams.get("boards") && user?.homeBoard) {
          const match = loaded.find((b) => b.name === user.homeBoard);
          if (match) {
            const params = new URLSearchParams(searchParams.toString());
            params.set("boards", match.id);
            if (params.get("sort") === DEFAULT_SORT) params.delete("sort");
            router.replace(`/climbs?${params.toString()}`, { scroll: false });
          }
        }
        defaultApplied.current = true;
        setBoardsLoaded(true);
      })
      .catch(() => { setBoardsLoaded(true); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ── Fetch climbs whenever URL params change ───────────────────────────────────
  useEffect(() => {
    if (!boardsLoaded) return;
    const f: ClimbFilters = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
    if (urlQuery)        f.q        = urlQuery;
    if (gradeMin)        f.gradeMin = gradeMin;
    if (gradeMax)        f.gradeMax = gradeMax;
    if (boardIds.length) f.boardIds = boardIds;
    if (angleMin)        f.angleMin = Number(angleMin);
    if (angleMax)        f.angleMax = Number(angleMax);
    if (sort)            f.sort     = sort;

    setLoading(true);
    getClimbs(f)
      .then(({ climbs, hasMore, total }) => {
        setClimbs(climbs);
        setHasMore(hasMore);
        setTotal(total);
      })
      .catch(() => { setClimbs([]); setHasMore(false); setTotal(0); })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, boardsLoaded]);

  // ── Close dropdowns on outside click ─────────────────────────────────────────
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (sortRef.current  && !sortRef.current.contains(e.target as Node))  setSortOpen(false);
      if (gradeRef.current && !gradeRef.current.contains(e.target as Node)) setGradeOpen(false);
      if (boardRef.current && !boardRef.current.contains(e.target as Node)) setBoardOpen(false);
      if (angleRef.current && !angleRef.current.contains(e.target as Node)) setAngleOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // ── Search (debounced) ────────────────────────────────────────────────────────
  function handleQueryChange(value: string) {
    setInputValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateParams({ q: value || null });
    }, 300);
  }

  // ── Grade range ───────────────────────────────────────────────────────────────
  const minIdx = gradeMin ? ALL_GRADES.indexOf(gradeMin) : -1;
  const maxIdx = gradeMax ? ALL_GRADES.indexOf(gradeMax) : -1;

  function handleGradeClick(grade: Grade) {
    const idx = ALL_GRADES.indexOf(grade);
    if (!gradeMin) {
      updateParams({ gradeMin: grade, gradeMax: null });
    } else if (!gradeMax) {
      if (idx === minIdx) {
        updateParams({ gradeMin: null, gradeMax: null });
      } else if (idx < minIdx) {
        updateParams({ gradeMin: grade, gradeMax: gradeMin });
      } else {
        updateParams({ gradeMin, gradeMax: grade });
      }
    } else {
      updateParams({ gradeMin: grade, gradeMax: null });
    }
  }

  function isInRange(grade: Grade): boolean {
    if (minIdx === -1) return false;
    const idx = ALL_GRADES.indexOf(grade);
    const hi  = maxIdx === -1 ? minIdx : maxIdx;
    return idx >= minIdx && idx <= hi;
  }

  // ── Labels ────────────────────────────────────────────────────────────────────
  const gradeLabel =
    !gradeMin ? "Grade" :
    !gradeMax ? gradeMin :
    `${gradeMin} – ${gradeMax}`;

  const boardLabel =
    boardIds.length === 0 ? "Board" :
    boardIds.length === 1 ? (boards.find((b) => b.id === boardIds[0])?.name ?? "Board") :
    `${boardIds.length} boards`;

  const hasAngleFilter = angleMin !== "" || angleMax !== "";
  const angleLabel =
    !hasAngleFilter ? "Angle" :
    angleMin && angleMax ? `${angleMin}°–${angleMax}°` :
    angleMin ? `≥${angleMin}°` : `≤${angleMax}°`;

  const hasGradeFilter = gradeMin !== null;
  const hasBoardFilter = boardIds.length > 0;

  return (
    <div>
      {tickTarget && user && (
        <TickModal
          climbId={tickTarget.id}
          climbName={tickTarget.name}
          onClose={() => setTickTarget(null)}
        />
      )}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white">Climbs</h1>
        <p className="text-stone-400 mt-1">
          {loading ? "Loading…" : `${total} climb${total !== 1 ? "s" : ""}`}
        </p>
      </div>

      {/* Search + filter row */}
      <div className="flex flex-wrap gap-2 mb-6">

        {/* Sort selector */}
        <div className="relative" ref={sortRef}>
          <button
            onClick={() => { setSortOpen((o) => !o); setGradeOpen(false); setBoardOpen(false); setAngleOpen(false); }}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors whitespace-nowrap bg-stone-800 border-stone-700 text-stone-300 hover:border-stone-500"
          >
            <span className="text-stone-500 font-normal">Sort:</span>
            {{
              sends_desc:       "Most Repeats",
              star_rating_desc: "Top Rated",
              grade_desc:       "Hardest First",
              grade_asc:        "Easiest First",
              has_video:        "Has Video",
            }[sort] ?? "Most Repeats"}
            <svg className="w-3.5 h-3.5 opacity-70" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>

          {sortOpen && (
            <div className="absolute left-0 sm:left-auto sm:right-0 top-full mt-2 z-30 bg-stone-900 border border-stone-700 rounded-xl shadow-2xl p-2 min-w-[170px]">
              <div className="px-2 pt-1 pb-2">
                <span className="text-white text-sm font-semibold">Sort by</span>
              </div>
              {([
                { value: "sends_desc",       label: "Most Repeats" },
                { value: "star_rating_desc", label: "Top Rated" },
                { value: "grade_desc",       label: "Hardest First" },
                { value: "grade_asc",        label: "Easiest First" },
                { value: "has_video",        label: "Has Video" },
              ] as const).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => { updateParams({ sort: value }); setSortOpen(false); }}
                  className={`w-full px-2 py-2.5 rounded-lg text-sm transition-colors text-left ${
                    sort === value ? "bg-stone-800 text-orange-400 font-medium" : "text-stone-300 hover:bg-stone-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search bar */}
        <div className="relative flex-1 min-w-48">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500 pointer-events-none"
            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
          >
            <circle cx={11} cy={11} r={8} /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search climbs…"
            value={inputValue}
            onChange={(e) => handleQueryChange(e.target.value)}
            className="w-full bg-stone-800 border border-stone-700 rounded-lg pl-9 pr-4 py-2.5 text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-500 transition-colors"
          />
          {inputValue && (
            <button
              onClick={() => handleQueryChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-white transition-colors"
            >
              ✕
            </button>
          )}
        </div>

        {/* Grade filter */}
        <div className="relative" ref={gradeRef}>
          <button
            onClick={() => { setGradeOpen((o) => !o); setBoardOpen(false); setAngleOpen(false); setSortOpen(false); }}
            className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors whitespace-nowrap ${
              hasGradeFilter
                ? "bg-orange-500 border-orange-500 text-white"
                : "bg-stone-800 border-stone-700 text-stone-300 hover:border-stone-500"
            }`}
          >
            {gradeLabel}
            <svg className="w-3.5 h-3.5 opacity-70" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>

          {gradeOpen && (
            <div className="absolute left-0 sm:left-auto sm:right-0 top-full mt-2 z-30 bg-stone-900 border border-stone-700 rounded-xl shadow-2xl p-4 w-72 max-w-[calc(100vw-2rem)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white text-sm font-semibold">Grade Range</span>
                {hasGradeFilter && (
                  <button
                    onClick={() => updateParams({ gradeMin: null, gradeMax: null })}
                    className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
              <p className="text-stone-500 text-xs mb-3 h-4">
                {!gradeMin ? "Click a grade to start"
                  : !gradeMax ? `From ${gradeMin} — click an end grade`
                  : `${gradeMin} through ${gradeMax}`}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ALL_GRADES.map((g) => {
                  const inRange    = isInRange(g);
                  const isEndpoint = g === gradeMin || g === gradeMax;
                  return (
                    <button
                      key={g}
                      onClick={() => handleGradeClick(g)}
                      className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${
                        isEndpoint
                          ? "bg-orange-500 text-white"
                          : inRange
                          ? "bg-orange-500/30 text-orange-300 ring-1 ring-orange-500/40"
                          : "bg-stone-700 text-stone-300 hover:bg-stone-600"
                      }`}
                    >
                      {g}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Angle filter */}
        <div className="relative" ref={angleRef}>
          <button
            onClick={() => { setAngleOpen((o) => !o); setGradeOpen(false); setBoardOpen(false); setSortOpen(false); }}
            className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors whitespace-nowrap ${
              hasAngleFilter
                ? "bg-orange-500 border-orange-500 text-white"
                : "bg-stone-800 border-stone-700 text-stone-300 hover:border-stone-500"
            }`}
          >
            {angleLabel}
            <svg className="w-3.5 h-3.5 opacity-70" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>

          {angleOpen && (
            <div className="absolute left-0 sm:left-auto sm:right-0 top-full mt-2 z-30 bg-stone-900 border border-stone-700 rounded-xl shadow-2xl p-4 w-56">
              <div className="flex items-center justify-between mb-3">
                <span className="text-white text-sm font-semibold">Angle (degrees)</span>
                {hasAngleFilter && (
                  <button
                    onClick={() => updateParams({ angleMin: null, angleMax: null })}
                    className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0} max={90}
                  placeholder="Min"
                  value={angleMin}
                  onChange={(e) => updateParams({ angleMin: e.target.value || null })}
                  className="w-full bg-stone-800 border border-stone-700 rounded-lg px-2 py-2 text-white text-sm placeholder:text-stone-600 focus:outline-none focus:border-orange-500 transition-colors"
                />
                <span className="text-stone-500 text-sm shrink-0">–</span>
                <input
                  type="number"
                  min={0} max={90}
                  placeholder="Max"
                  value={angleMax}
                  onChange={(e) => updateParams({ angleMax: e.target.value || null })}
                  className="w-full bg-stone-800 border border-stone-700 rounded-lg px-2 py-2 text-white text-sm placeholder:text-stone-600 focus:outline-none focus:border-orange-500 transition-colors"
                />
              </div>
            </div>
          )}
        </div>

        {/* Board filter */}
        <div className="relative" ref={boardRef}>
          <button
            onClick={() => { setBoardOpen((o) => !o); setGradeOpen(false); setAngleOpen(false); setSortOpen(false); }}
            className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors whitespace-nowrap ${
              hasBoardFilter
                ? "bg-orange-500 border-orange-500 text-white"
                : "bg-stone-800 border-stone-700 text-stone-300 hover:border-stone-500"
            }`}
          >
            {boardLabel}
            <svg
              className={`w-3.5 h-3.5 opacity-70 transition-transform ${boardOpen ? "rotate-180" : ""}`}
              fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"
            >
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>

          {boardOpen && (
            <div className="absolute right-0 top-full mt-2 z-30 bg-stone-800 border border-stone-700 rounded-lg shadow-2xl py-1 min-w-[200px]">
              <label className="flex items-center gap-2.5 px-3 py-2 hover:bg-stone-700/60 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={boardIds.length === 0}
                  onChange={() => updateParams({ boards: null })}
                  className="accent-orange-500 w-3.5 h-3.5"
                />
                <span className="text-sm text-stone-300">All boards</span>
              </label>
              <div className="my-1 border-t border-stone-700" />
              {boards.map((b) => (
                <div key={b.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-stone-700/60 select-none">
                  <input
                    type="checkbox"
                    checked={boardIds.includes(b.id)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...boardIds, b.id]
                        : boardIds.filter((id) => id !== b.id);
                      updateParams({ boards: next.join(",") || null });
                    }}
                    className="accent-orange-500 w-3.5 h-3.5 cursor-pointer shrink-0"
                  />
                  <button
                    onClick={() => { updateParams({ boards: b.id }); setBoardOpen(false); }}
                    className="text-sm text-stone-300 hover:text-white text-left flex-1 cursor-pointer"
                  >
                    {b.name}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div className="text-center py-16 text-stone-500">Loading…</div>
      ) : climbs.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-stone-500">
            {urlQuery ? `No results for "${urlQuery}".` : "No climbs match these filters."}
          </p>
          {urlQuery && user && (
            <Link
              href={`/climbs/new?name=${encodeURIComponent(urlQuery)}${boardIds.length === 1 ? `&boardId=${encodeURIComponent(boardIds[0])}` : ""}`}
              className="mt-3 inline-flex items-center gap-1 text-orange-400 hover:text-orange-300 text-sm font-medium transition-colors"
            >
              Create the climb &ldquo;<span className="text-white font-semibold">{urlQuery}</span>&rdquo; →
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            {climbs.map((climb) => (
              <ClimbCard
                key={climb.id}
                climb={climb}
                canTick={!!user}
                onTick={() => setTickTarget({ id: climb.id, name: climb.name })}
              />
            ))}
          </div>
          {(page > 1 || hasMore) && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <button
                onClick={() => updateParams({ page: String(page - 1) }, false)}
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
                onClick={() => updateParams({ page: String(page + 1) }, false)}
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
      )}

      {user && !(climbs.length === 0 && urlQuery) && (
        <div className="flex justify-end mt-6">
          <Link
            href="/climbs/new"
            className="text-stone-500 hover:text-stone-300 text-sm transition-colors"
          >
            + Submit climb
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Page shell (Suspense required for useSearchParams) ────────────────────────

export default function ClimbsPage() {
  return (
    <Suspense fallback={<div className="text-center py-16 text-stone-500">Loading…</div>}>
      <ClimbsPageInner />
    </Suspense>
  );
}
