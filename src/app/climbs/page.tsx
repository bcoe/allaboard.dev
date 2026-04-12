"use client";

import { useEffect, useState, useRef } from "react";
import { Grade, Board } from "@/lib/types";
import { ALL_GRADES } from "@/lib/utils";
import { getClimbs, ClimbFilters } from "@/lib/db";
import { useAuth } from "@/lib/auth-context";
import ClimbCard from "@/components/ClimbCard";
import TickModal from "@/components/TickModal";
import Link from "next/link";
import type { Climb } from "@/lib/types";

const PAGE_SIZE = 25;

export default function ClimbsPage() {
  const { user } = useAuth();
  const [climbs, setClimbs]       = useState<Climb[]>([]);
  const [boards, setBoards]       = useState<Board[]>([]);
  const [tickTarget, setTickTarget] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading]     = useState(true);
  const [hasMore, setHasMore]     = useState(false);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [boardsLoaded, setBoardsLoaded] = useState(false);
  const defaultApplied = useRef(false);

  // Filter state
  const [query, setQuery]         = useState("");
  const [gradeMin, setGradeMin]   = useState<Grade | null>(null);
  const [gradeMax, setGradeMax]   = useState<Grade | null>(null);
  const [boardIds, setBoardIds]   = useState<string[]>([]);
  const [angleMin, setAngleMin]   = useState<string>("");
  const [angleMax, setAngleMax]   = useState<string>("");
  const [sort, setSort]           = useState("sends_desc");

  // Dropdown open state
  const [sortOpen, setSortOpen]   = useState(false);
  const [gradeOpen, setGradeOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [angleOpen, setAngleOpen] = useState(false);

  const sortRef  = useRef<HTMLDivElement>(null);
  const gradeRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const angleRef = useRef<HTMLDivElement>(null);

  // Load boards once; apply user's home board as default filter on first load
  useEffect(() => {
    fetch("/api/boards")
      .then((r) => r.json())
      .then((loaded: Board[]) => {
        setBoards(loaded);
        if (!defaultApplied.current && user?.homeBoard) {
          const match = loaded.find((b) => b.name === user.homeBoard);
          if (match) setBoardIds([match.id]);
          defaultApplied.current = true;
        }
        setBoardsLoaded(true);
      })
      .catch(() => { setBoardsLoaded(true); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function buildFilters(p: number): ClimbFilters {
    const f: ClimbFilters = { limit: PAGE_SIZE, offset: (p - 1) * PAGE_SIZE };
    if (query)    f.q        = query;
    if (gradeMin) f.gradeMin = gradeMin;
    if (gradeMax) f.gradeMax = gradeMax;
    if (boardIds.length) f.boardIds = boardIds;
    if (angleMin) f.angleMin = Number(angleMin);
    if (angleMax) f.angleMax = Number(angleMax);
    if (sort)     f.sort     = sort;
    return f;
  }

  // Reset to page 1 when any filter changes
  useEffect(() => {
    setPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, gradeMin, gradeMax, boardIds, angleMin, angleMax, sort]);

  // Fetch whenever filters or page change — wait until boards (and default boardId) are set
  useEffect(() => {
    if (!boardsLoaded) return;
    setLoading(true);
    getClimbs(buildFilters(page))
      .then(({ climbs, hasMore, total }) => {
        setClimbs(climbs);
        setHasMore(hasMore);
        setTotal(total);
      })
      .catch(() => { setClimbs([]); setHasMore(false); setTotal(0); })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, gradeMin, gradeMax, boardIds, angleMin, angleMax, sort, boardsLoaded, page]);

  // Close dropdowns on outside click
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

  // ── Grade range helpers ────────────────────────────────────────────────────
  const minIdx = gradeMin ? ALL_GRADES.indexOf(gradeMin) : -1;
  const maxIdx = gradeMax ? ALL_GRADES.indexOf(gradeMax) : -1;

  function handleGradeClick(grade: Grade) {
    const idx = ALL_GRADES.indexOf(grade);
    if (!gradeMin) {
      setGradeMin(grade);
    } else if (!gradeMax) {
      if (idx === minIdx) {
        setGradeMin(null);
      } else if (idx < minIdx) {
        setGradeMin(grade);
        setGradeMax(gradeMin);
      } else {
        setGradeMax(grade);
      }
    } else {
      setGradeMin(grade);
      setGradeMax(null);
    }
  }

  function isInRange(grade: Grade): boolean {
    if (minIdx === -1) return false;
    const idx = ALL_GRADES.indexOf(grade);
    const lo = minIdx;
    const hi = maxIdx === -1 ? minIdx : maxIdx;
    return idx >= lo && idx <= hi;
  }

  // ── Labels ─────────────────────────────────────────────────────────────────
  const gradeLabel =
    !gradeMin ? "Grade" :
    !gradeMax ? gradeMin :
    `${gradeMin} – ${gradeMax}`;

  const boardLabel =
    boardIds.length === 0 ? "Board" :
    boardIds.length === 1 ? (boards.find((b) => b.id === boardIds[0])?.name ?? "Board") :
    `${boardIds.length} boards`;

  const hasAngleFilter = angleMin !== "" || angleMax !== "";
  const angleLabel     = !hasAngleFilter ? "Angle" :
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Climbs</h1>
          <p className="text-stone-400 mt-1">
            {loading ? "Loading…" : `${total} climb${total !== 1 ? "s" : ""}`}
          </p>
        </div>
        {user && (
          <Link
            href="/climbs/new"
            className="bg-orange-500 hover:bg-orange-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Submit Climb
          </Link>
        )}
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
            }[sort]}
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
                { value: "sends_desc",      label: "Most Repeats" },
                { value: "star_rating_desc", label: "Top Rated" },
                { value: "grade_desc",       label: "Hardest First" },
                { value: "grade_asc",        label: "Easiest First" },
                { value: "has_video",        label: "Has Video" },
              ] as const).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => { setSort(value); setSortOpen(false); }}
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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-stone-800 border border-stone-700 rounded-lg pl-9 pr-4 py-2.5 text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-500 transition-colors"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
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
                    onClick={() => { setGradeMin(null); setGradeMax(null); }}
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
                  const inRange   = isInRange(g);
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
                    onClick={() => { setAngleMin(""); setAngleMax(""); }}
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
                  onChange={(e) => setAngleMin(e.target.value)}
                  className="w-full bg-stone-800 border border-stone-700 rounded-lg px-2 py-2 text-white text-sm placeholder:text-stone-600 focus:outline-none focus:border-orange-500 transition-colors"
                />
                <span className="text-stone-500 text-sm shrink-0">–</span>
                <input
                  type="number"
                  min={0} max={90}
                  placeholder="Max"
                  value={angleMax}
                  onChange={(e) => setAngleMax(e.target.value)}
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
              {/* "All boards" clears the selection */}
              <label className="flex items-center gap-2.5 px-3 py-2 hover:bg-stone-700/60 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={boardIds.length === 0}
                  onChange={() => setBoardIds([])}
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
                    onChange={(e) =>
                      setBoardIds(e.target.checked
                        ? [...boardIds, b.id]
                        : boardIds.filter((id) => id !== b.id))
                    }
                    className="accent-orange-500 w-3.5 h-3.5 cursor-pointer shrink-0"
                  />
                  <button
                    onClick={() => { setBoardIds([b.id]); setBoardOpen(false); }}
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
        <div className="text-center py-16 text-stone-500">No climbs match these filters.</div>
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
      )}
    </div>
  );
}
