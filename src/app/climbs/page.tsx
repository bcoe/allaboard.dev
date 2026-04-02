"use client";

import { useEffect, useState, useRef, useCallback } from "react";
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]     = useState(false);
  const [boardsLoaded, setBoardsLoaded] = useState(false);
  const offsetRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const defaultApplied = useRef(false);

  // Filter state
  const [query, setQuery]       = useState("");
  const [gradeMin, setGradeMin] = useState<Grade | null>(null);
  const [gradeMax, setGradeMax] = useState<Grade | null>(null);
  const [boardId, setBoardId]   = useState<string>("");
  const [angleMin, setAngleMin] = useState<string>("");
  const [angleMax, setAngleMax] = useState<string>("");
  const [sort, setSort]         = useState("sends_desc");

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
          if (match) setBoardId(match.id);
          defaultApplied.current = true;
        }
        setBoardsLoaded(true);
      })
      .catch(() => { setBoardsLoaded(true); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function buildFilters(offset: number): ClimbFilters {
    const f: ClimbFilters = { limit: PAGE_SIZE, offset };
    if (query)    f.q        = query;
    if (gradeMin) f.gradeMin = gradeMin;
    if (gradeMax) f.gradeMax = gradeMax;
    if (boardId)  f.boardId  = boardId;
    if (angleMin) f.angleMin = Number(angleMin);
    if (angleMax) f.angleMax = Number(angleMax);
    if (sort)     f.sort     = sort;
    return f;
  }

  // Reset and reload when filters change — wait until boards (and default boardId) are set
  useEffect(() => {
    if (!boardsLoaded) return;
    setLoading(true);
    offsetRef.current = 0;
    getClimbs(buildFilters(0))
      .then(({ climbs, hasMore }) => {
        setClimbs(climbs);
        setHasMore(hasMore);
        offsetRef.current = climbs.length;
      })
      .catch(() => { setClimbs([]); setHasMore(false); })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, gradeMin, gradeMax, boardId, angleMin, angleMax, sort, boardsLoaded]);

  // Load next page
  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    getClimbs(buildFilters(offsetRef.current))
      .then(({ climbs: next, hasMore: more }) => {
        setClimbs((prev) => [...prev, ...next]);
        setHasMore(more);
        offsetRef.current += next.length;
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMore, hasMore, query, gradeMin, gradeMax, boardId, angleMin, angleMax, sort]);

  // IntersectionObserver on sentinel
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore(); },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

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

  const selectedBoard = boards.find((b) => b.id === boardId);
  const boardLabel    = selectedBoard ? selectedBoard.name : "Board";

  const hasAngleFilter = angleMin !== "" || angleMax !== "";
  const angleLabel     = !hasAngleFilter ? "Angle" :
    angleMin && angleMax ? `${angleMin}°–${angleMax}°` :
    angleMin ? `≥${angleMin}°` : `≤${angleMax}°`;

  const hasGradeFilter = gradeMin !== null;
  const hasBoardFilter = boardId !== "";

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
            {loading ? "Loading…" : `${climbs.length} climb${climbs.length !== 1 ? "s" : ""}`}
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
            <svg className="w-3.5 h-3.5 opacity-70" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>

          {boardOpen && (
            <div className="absolute right-0 top-full mt-2 z-30 bg-stone-900 border border-stone-700 rounded-xl shadow-2xl p-2 min-w-[200px]">
              <div className="flex items-center justify-between px-2 pt-1 pb-2">
                <span className="text-white text-sm font-semibold">Board</span>
                {hasBoardFilter && (
                  <button
                    onClick={() => setBoardId("")}
                    className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
              {boards.map((b) => (
                <button
                  key={b.id}
                  onClick={() => { setBoardId(b.id === boardId ? "" : b.id); setBoardOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-2 py-2.5 rounded-lg text-sm transition-colors text-left ${
                    boardId === b.id ? "bg-stone-800 text-white" : "text-stone-300 hover:bg-stone-800"
                  }`}
                >
                  <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                    boardId === b.id ? "bg-orange-500 border-orange-500" : "border-stone-600"
                  }`}>
                    {boardId === b.id && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                        <path d="M20 6 9 17l-5-5"/>
                      </svg>
                    )}
                  </span>
                  {b.name}
                </button>
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
          {/* Sentinel — triggers loadMore when scrolled into view */}
          <div ref={sentinelRef} className="h-4" />
          {loadingMore && (
            <div className="text-center py-6 text-stone-500 text-sm">Loading more…</div>
          )}
          {!hasMore && climbs.length >= PAGE_SIZE && (
            <div className="text-center py-6 text-stone-600 text-sm">All climbs loaded</div>
          )}
        </>
      )}
    </div>
  );
}
