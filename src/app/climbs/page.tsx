"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Climb, BoardType, Grade } from "@/lib/types";
import { ALL_GRADES } from "@/lib/utils";
import { getClimbs } from "@/lib/db";
import ClimbCard from "@/components/ClimbCard";
import Link from "next/link";

const BOARDS: BoardType[] = ["Kilter", "Moonboard"];

export default function ClimbsPage() {
  const [climbs, setClimbs]     = useState<Climb[]>([]);
  const [query, setQuery]       = useState("");
  const [gradeMin, setGradeMin] = useState<Grade | null>(null);
  const [gradeMax, setGradeMax] = useState<Grade | null>(null);
  const [boards, setBoards]     = useState<BoardType[]>([]);
  const [gradeOpen, setGradeOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);

  const gradeRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(() => {
    void (async () => {
      setClimbs(await getClimbs());
    })();
  }, []);

  useEffect(reload, [reload]);

  // Close dropdowns on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (gradeRef.current && !gradeRef.current.contains(e.target as Node)) setGradeOpen(false);
      if (boardRef.current && !boardRef.current.contains(e.target as Node)) setBoardOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // ── Grade range selection ─────────────────────────────────────────────────
  const minIdx = gradeMin ? ALL_GRADES.indexOf(gradeMin) : -1;
  const maxIdx = gradeMax ? ALL_GRADES.indexOf(gradeMax) : -1;

  function handleGradeClick(grade: Grade) {
    const idx = ALL_GRADES.indexOf(grade);
    if (!gradeMin) {
      setGradeMin(grade);
    } else if (!gradeMax) {
      if (idx === minIdx) {
        setGradeMin(null); // deselect single
      } else if (idx < minIdx) {
        setGradeMin(grade);
        setGradeMax(gradeMin);
      } else {
        setGradeMax(grade);
      }
    } else {
      // Reset and start a new range
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

  // ── Board toggle ──────────────────────────────────────────────────────────
  function toggleBoard(board: BoardType) {
    setBoards((prev) =>
      prev.includes(board) ? prev.filter((b) => b !== board) : [...prev, board]
    );
  }

  // ── Filtering (boards → grade range → name) ───────────────────────────────
  const filtered = climbs.filter((c) => {
    if (boards.length > 0 && !boards.includes(c.boardType)) return false;
    if (gradeMin) {
      const cIdx = ALL_GRADES.indexOf(c.grade);
      const lo = minIdx;
      const hi = maxIdx === -1 ? minIdx : maxIdx;
      if (cIdx < lo || cIdx > hi) return false;
    }
    if (query && !c.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  // ── Button labels ─────────────────────────────────────────────────────────
  const gradeLabel =
    !gradeMin ? "Grade" :
    !gradeMax ? gradeMin :
    `${gradeMin} – ${gradeMax}`;

  const boardLabel =
    boards.length === 0 ? "Board" : boards.join(" · ");

  const hasGradeFilter = gradeMin !== null;
  const hasBoardFilter = boards.length > 0;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Climbs</h1>
          <p className="text-stone-400 mt-1">
            {filtered.length} climb{filtered.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link
          href="/climbs/new"
          className="bg-orange-500 hover:bg-orange-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Submit Climb
        </Link>
      </div>

      {/* Search + filter row */}
      <div className="flex gap-2 mb-6">

        {/* Search bar */}
        <div className="relative flex-1">
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
            onClick={() => { setGradeOpen((o) => !o); setBoardOpen(false); }}
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
            <div className="absolute right-0 top-full mt-2 z-30 bg-stone-900 border border-stone-700 rounded-xl shadow-2xl p-4 w-72">
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
                {!gradeMin
                  ? "Click a grade to start"
                  : !gradeMax
                  ? `From ${gradeMin} — click an end grade`
                  : `${gradeMin} through ${gradeMax}`}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ALL_GRADES.map((g) => {
                  const inRange = isInRange(g);
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

        {/* Board filter */}
        <div className="relative" ref={boardRef}>
          <button
            onClick={() => { setBoardOpen((o) => !o); setGradeOpen(false); }}
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
            <div className="absolute right-0 top-full mt-2 z-30 bg-stone-900 border border-stone-700 rounded-xl shadow-2xl p-2 min-w-[160px]">
              <div className="flex items-center justify-between px-2 pt-1 pb-2">
                <span className="text-white text-sm font-semibold">Board</span>
                {hasBoardFilter && (
                  <button
                    onClick={() => setBoards([])}
                    className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
              {BOARDS.map((b) => (
                <button
                  key={b}
                  onClick={() => toggleBoard(b)}
                  className={`w-full flex items-center gap-2.5 px-2 py-2.5 rounded-lg text-sm transition-colors text-left ${
                    boards.includes(b) ? "bg-stone-800 text-white" : "text-stone-300 hover:bg-stone-800"
                  }`}
                >
                  <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                    boards.includes(b) ? "bg-orange-500 border-orange-500" : "border-stone-600"
                  }`}>
                    {boards.includes(b) && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                        <path d="M20 6 9 17l-5-5"/>
                      </svg>
                    )}
                  </span>
                  {b}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-stone-500">No climbs match these filters.</div>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((climb) => (
            <ClimbCard key={climb.id} climb={climb} />
          ))}
        </div>
      )}
    </div>
  );
}
