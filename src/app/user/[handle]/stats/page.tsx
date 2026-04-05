"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { EChartsOption } from "echarts";
import { getUserTicks } from "@/lib/db";
import { UserTick } from "@/lib/types";
import { ALL_GRADES, timeAgo } from "@/lib/utils";
import StatCard from "@/components/StatCard";

// Hex equivalents of the GRADE_COLORS Tailwind classes
const GRADE_HEX: Record<string, string> = {
  V0:  "#15803d",
  V1:  "#16a34a",
  V2:  "#22c55e",
  V3:  "#84cc16",
  V4:  "#eab308",
  V5:  "#f59e0b",
  V6:  "#f97316",
  V7:  "#ea580c",
  V8:  "#ef4444",
  V9:  "#dc2626",
  V10: "#b91c1c",
  V11: "#be123c",
  V12: "#9333ea",
  V13: "#7e22ce",
  V14: "#db2777",
  V15: "#be185d",
  V16: "#86198f",
  V17: "#4a044e",
  V18: "#1c1917",
};

// Lightweight ECharts wrapper — initialises on mount, updates on option change, cleans up on unmount.
function EChart({ option, height = 360 }: { option: EChartsOption; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<import("echarts").ECharts | null>(null);

  // Init once
  useEffect(() => {
    if (!containerRef.current) return;
    let chart: import("echarts").ECharts;
    void import("echarts").then((echarts) => {
      if (!containerRef.current) return;
      chart = echarts.init(containerRef.current);
      chartRef.current = chart;
      chart.setOption(option);
      const ro = new ResizeObserver(() => chart.resize());
      ro.observe(containerRef.current!);
      (chart as any).__ro = ro;
    });
    return () => {
      chartRef.current?.dispose();
      (chartRef.current as any)?.__ro?.disconnect();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update when option changes
  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}

// ─── Tooltip HTML ─────────────────────────────────────────────────────────────

const MAX_TOOLTIP_TICKS = 5;

function ticksToTooltipHtml(ticks: UserTick[]): string {
  if (ticks.length === 0) return "";
  const shown = ticks.slice(0, MAX_TOOLTIP_TICKS);

  const items = shown.map((tick, i) => {
    const gradeBadge = `<span style="background:${GRADE_HEX[tick.grade]};color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;display:inline-block">${tick.grade}</span>`;

    const name = `<span style="color:#fff;font-size:11px;font-weight:600">${tick.climbName}</span>`;

    const metaParts = [
      tick.boardName ? `${tick.boardName}${tick.angle != null ? ` · ${tick.angle}°` : ""}` : null,
      tick.attempts != null ? `${tick.attempts} att.` : null,
      timeAgo(tick.date.slice(0, 10)),
    ].filter(Boolean).join(" · ");

    const divider = i > 0
      ? `<div style="border-top:1px solid #292524;margin:5px 0"></div>`
      : "";

    return `${divider}
      <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
        ${gradeBadge}${name}
      </div>
      <div style="color:#78716c;font-size:10px;margin-top:2px">${metaParts}</div>`;
  }).join("");

  const overflow = ticks.length > MAX_TOOLTIP_TICKS
    ? `<div style="color:#78716c;font-size:10px;margin-top:6px">+${ticks.length - MAX_TOOLTIP_TICKS} more</div>`
    : "";

  return `<div style="background:#1c1917;border:1px solid #44403c;border-radius:10px;padding:10px 12px;max-width:260px;min-width:160px">${items}${overflow}</div>`;
}

// ─── Chart builders ───────────────────────────────────────────────────────────

/** Returns every YYYY-MM-DD string from dateFrom to dateTo inclusive. */
function allDatesInRange(dateFrom: string, dateTo: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(dateFrom + "T00:00:00");
  const end    = new Date(dateTo   + "T00:00:00");
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function buildHeatmapOption(ticks: UserTick[], dateFrom: string, dateTo: string, isMobile = false): EChartsOption {
  const countMap = new Map<string, number>();
  const ticksByCell = new Map<string, UserTick[]>();
  for (const tick of ticks) {
    const key = `${tick.date.slice(0, 10)}|${tick.grade}`;
    countMap.set(key, (countMap.get(key) ?? 0) + 1);
    if (!ticksByCell.has(key)) ticksByCell.set(key, []);
    ticksByCell.get(key)!.push(tick);
  }

  const dates = allDatesInRange(dateFrom, dateTo);
  const grades = ALL_GRADES;

  const raw: { di: number; gi: number; count: number }[] = [];
  for (let di = 0; di < dates.length; di++) {
    for (let gi = 0; gi < grades.length; gi++) {
      const count = countMap.get(`${dates[di]}|${grades[gi]}`) ?? 0;
      if (count > 0) raw.push({ di, gi, count });
    }
  }

  const maxCount = Math.max(...raw.map((d) => d.count), 1);

  const data = raw.map(({ di, gi, count }) => ({
    value: [di, gi, count] as [number, number, number],
    itemStyle: {
      color: GRADE_HEX[grades[gi]],
      opacity: 0.25 + (count / maxCount) * 0.75,
    },
  }));

  return {
    backgroundColor: "transparent",
    tooltip: {
      formatter: (params: any) => {
        const [di, gi] = params.value as [number, number, number];
        const key = `${dates[di]}|${grades[gi]}`;
        return ticksToTooltipHtml(ticksByCell.get(key) ?? []);
      },
      backgroundColor: "transparent",
      borderColor: "transparent",
      padding: 0,
      extraCssText: "box-shadow:none",
    },
    grid: { left: isMobile ? 38 : 50, right: 10, top: 15, bottom: isMobile ? 48 : 70 },
    xAxis: {
      type: "category",
      data: dates,
      axisLabel: { color: "#a8a29e", fontSize: isMobile ? 9 : 10, rotate: 45, interval: "auto" },
      axisLine: { lineStyle: { color: "#44403c" } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "category",
      data: grades,
      axisLabel: { color: "#a8a29e", fontSize: isMobile ? 9 : 10 },
      axisLine: { lineStyle: { color: "#44403c" } },
      splitLine: { show: false },
    },
    // visualMap is required by ECharts for heatmap series; we hide it and
    // override colours per-item via itemStyle so the grade palette is used.
    visualMap: {
      show: false,
      min: 0,
      max: maxCount,
    },
    series: [
      {
        type: "heatmap",
        data,
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: "rgba(0,0,0,0.5)" } },
      },
    ],
  };
}

function buildPyramidOption(ticks: UserTick[]): EChartsOption {
  const gradeCounts = new Map<string, number>();
  const ticksByGrade = new Map<string, UserTick[]>();
  for (const tick of ticks) {
    if (!tick.sent) continue;
    gradeCounts.set(tick.grade, (gradeCounts.get(tick.grade) ?? 0) + 1);
    if (!ticksByGrade.has(tick.grade)) ticksByGrade.set(tick.grade, []);
    ticksByGrade.get(tick.grade)!.push(tick);
  }

  const gradesWithSends = ALL_GRADES.filter((g) => (gradeCounts.get(g) ?? 0) > 0);

  if (gradesWithSends.length === 0) {
    return {
      backgroundColor: "transparent",
      graphic: [
        {
          type: "text",
          left: "center",
          top: "center",
          style: { text: "No sends yet", fill: "#78716c", fontSize: 14 },
        },
      ],
    };
  }

  // ALL_GRADES is ordered V0→V18; ECharts renders categories bottom-to-top,
  // so the last item in the array appears at the top — no reversal needed.
  const pyramidGrades = [...gradesWithSends];
  const counts = pyramidGrades.map((g) => gradeCounts.get(g) ?? 0);
  const maxCount = Math.max(...counts);

  // Center bars within the [0, maxCount*2] axis.
  // Each bar must start at (maxCount - count/2) so its centre lands at maxCount (the axis midpoint).
  const spacers = counts.map((c) => maxCount - c / 2);

  return {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "none" },
      formatter: (params: any) => {
        const p = Array.isArray(params) ? params.find((x: any) => x.seriesIndex === 1) ?? params[0] : params;
        return ticksToTooltipHtml(ticksByGrade.get(p.name) ?? []);
      },
      backgroundColor: "transparent",
      borderColor: "transparent",
      padding: 0,
      extraCssText: "box-shadow:none",
    },
    grid: { left: 55, right: 55, top: 10, bottom: 10 },
    xAxis: {
      type: "value",
      max: maxCount * 2,
      axisLabel: { show: false },
      axisLine: { show: false },
      splitLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: "category",
      data: pyramidGrades,
      axisLabel: { color: "#a8a29e", fontSize: 10 },
      axisLine: { lineStyle: { color: "#44403c" } },
      splitLine: { show: false },
    },
    series: [
      {
        type: "bar",
        stack: "pyramid",
        silent: true,
        itemStyle: { color: "transparent" },
        data: spacers,
        label: { show: false },
      },
      {
        type: "bar",
        stack: "pyramid",
        data: pyramidGrades.map((grade, i) => ({
          value: counts[i],
          itemStyle: { color: GRADE_HEX[grade] },
        })),
        label: {
          show: true,
          position: "right",
          color: "#a8a29e",
          fontSize: 10,
          formatter: (params: any) => String(counts[params.dataIndex]),
        },
      },
    ],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultDateFrom(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return toDateString(d);
}

interface ChartFilter {
  dateFrom: string;
  dateTo: string;
  boards: string[];
}

function makeDefaultFilter(months: number): ChartFilter {
  return { dateFrom: defaultDateFrom(months), dateTo: toDateString(new Date()), boards: [] };
}

/** True when called in a browser with a narrow viewport (Tailwind `sm` breakpoint). */
function isMobileScreen(): boolean {
  return typeof window !== "undefined" && window.innerWidth < 640;
}

function applyFilter(ticks: UserTick[], filter: ChartFilter): UserTick[] {
  return ticks.filter((t) => {
    const d = t.date.slice(0, 10);
    if (d < filter.dateFrom || d > filter.dateTo) return false;
    if (filter.boards.length > 0 && !filter.boards.includes(t.boardName)) return false;
    return true;
  });
}

// ─── BoardSelect ──────────────────────────────────────────────────────────────

function BoardSelect({
  allBoards,
  selected,
  onChange,
}: {
  allBoards: string[];
  selected: string[];
  onChange: (boards: string[]) => void;
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

  const label =
    selected.length === 0 ? "All boards" :
    selected.length === 1 ? selected[0] :
    `${selected.length} boards`;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 bg-stone-800 border border-stone-700 hover:border-stone-500 rounded-lg px-3 py-1.5 text-sm text-stone-300 transition-colors"
      >
        <span className="truncate max-w-40">{label}</span>
        <svg
          className={`w-3 h-3 text-stone-500 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5"
        >
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-stone-800 border border-stone-700 rounded-lg shadow-2xl z-20 min-w-48 py-1">
          <label className="flex items-center gap-2.5 px-3 py-2 hover:bg-stone-700/60 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={selected.length === 0}
              onChange={() => onChange([])}
              className="accent-orange-500 w-3.5 h-3.5"
            />
            <span className="text-sm text-stone-300">All boards</span>
          </label>
          <div className="my-1 border-t border-stone-700" />
          {allBoards.map((board) => (
            <label key={board} className="flex items-center gap-2.5 px-3 py-2 hover:bg-stone-700/60 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={selected.includes(board)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...selected, board] : selected.filter((b) => b !== board))
                }
                className="accent-orange-500 w-3.5 h-3.5"
              />
              <span className="text-sm text-stone-300">{board}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ChartFilters ─────────────────────────────────────────────────────────────

function ChartFilters({
  allBoards,
  filter,
  onChange,
}: {
  allBoards: string[];
  filter: ChartFilter;
  onChange: (f: ChartFilter) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <input
        type="date"
        value={filter.dateFrom}
        max={filter.dateTo}
        onChange={(e) => onChange({ ...filter, dateFrom: e.target.value })}
        className="bg-stone-800 border border-stone-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-orange-500 transition-colors"
      />
      <span className="text-stone-500 text-sm">to</span>
      <input
        type="date"
        value={filter.dateTo}
        min={filter.dateFrom}
        max={toDateString(new Date())}
        onChange={(e) => onChange({ ...filter, dateTo: e.target.value })}
        className="bg-stone-800 border border-stone-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-orange-500 transition-colors"
      />
      {allBoards.length > 0 && (
        <BoardSelect
          allBoards={allBoards}
          selected={filter.boards}
          onChange={(boards) => onChange({ ...filter, boards })}
        />
      )}
    </div>
  );
}

// ─── Streak helper ────────────────────────────────────────────────────────────

/** Returns the Sunday that starts the Sun–Sat week containing dateStr (YYYY-MM-DD). */
function weekSunday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // getUTCDay(): 0=Sun … 6=Sat
  return d.toISOString().slice(0, 10);
}

/** Longest run of consecutive Sun–Sat weeks that each contained at least one tick. */
function computeLongestStreak(ticks: UserTick[]): number {
  const weeks = [...new Set(ticks.map((t) => weekSunday(t.date.slice(0, 10))))].sort();
  if (weeks.length === 0) return 0;
  let longest = 1;
  let current = 1;
  for (let i = 1; i < weeks.length; i++) {
    const prev = new Date(weeks[i - 1] + "T00:00:00Z");
    const curr = new Date(weeks[i]     + "T00:00:00Z");
    const daysDiff = (curr.getTime() - prev.getTime()) / 86_400_000;
    if (daysDiff === 7) {
      current++;
      if (current > longest) longest = current;
    } else {
      current = 1;
    }
  }
  return longest;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UserStatsPage() {
  const { handle } = useParams<{ handle: string }>();

  const [ticks, setTicks] = useState<UserTick[]>([]);
  const [isMobile, setIsMobile] = useState(isMobileScreen);
  const [heatmapFilter, setHeatmapFilter] = useState<ChartFilter>(() => makeDefaultFilter(isMobileScreen() ? 1 : 3));
  const [pyramidFilter, setPyramidFilter] = useState<ChartFilter>(() => makeDefaultFilter(isMobileScreen() ? 1 : 3));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth < 640); }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!handle) return;
    setLoading(true);
    void getUserTicks(handle).then((t) => {
      setTicks(t);
      setLoading(false);
    });
  }, [handle]);

  const allBoards = useMemo(() => {
    const seen = new Set<string>();
    for (const t of ticks) if (t.boardName) seen.add(t.boardName);
    return [...seen].sort();
  }, [ticks]);

  const heatmapTicks = useMemo(() => applyFilter(ticks, heatmapFilter), [ticks, heatmapFilter]);
  const pyramidTicks = useMemo(() => applyFilter(ticks, pyramidFilter), [ticks, pyramidFilter]);

  const heatmapOption = useMemo(
    () => buildHeatmapOption(heatmapTicks, heatmapFilter.dateFrom, heatmapFilter.dateTo, isMobile),
    [heatmapTicks, heatmapFilter.dateFrom, heatmapFilter.dateTo, isMobile],
  );
  const pyramidOption = useMemo(() => buildPyramidOption(pyramidTicks), [pyramidTicks]);

  const rowHeight    = isMobile ? 26 : 38;
  const heatmapHeight = isMobile ? 220 : 360;
  const pyramidHeight = useMemo(() => {
    const sent = new Set(pyramidTicks.filter((t) => t.sent).map((t) => t.grade));
    return Math.max(isMobile ? 120 : 160, sent.size * rowHeight + (isMobile ? 30 : 40));
  }, [pyramidTicks, isMobile, rowHeight]);

  const totalSends    = useMemo(() => ticks.filter((t) => t.sent).length, [ticks]);
  const longestStreak = useMemo(() => computeLongestStreak(ticks), [ticks]);

  if (loading) {
    return <div className="text-stone-500 text-center py-16">Loading…</div>;
  }

  return (
    <div>
      <div className="mb-8 flex items-center gap-3">
        <Link
          href={`/user/${handle}`}
          className="text-stone-400 hover:text-white transition-colors"
          aria-label="Back to profile"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <h1 className="text-3xl font-bold text-white">Detailed Stats for @{handle}</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-10">
        <StatCard label="Lifetime Sends"  value={totalSends}           accent="text-green-400" />
        <StatCard label="Longest Streak" value={`${longestStreak}w`}  sub="consecutive weeks sending something" accent="text-yellow-400" />
      </div>

      {ticks.length === 0 ? (
        <p className="text-stone-500 text-center py-16">more, more!</p>
      ) : (
        <>
          <section className="mb-10">
            <h2 className="text-orange-400 font-semibold text-lg mb-1">Sends</h2>
            <p className="text-stone-500 text-sm mb-3">More, more!</p>
            <ChartFilters allBoards={allBoards} filter={heatmapFilter} onChange={setHeatmapFilter} />
            <div className="bg-stone-900 border border-stone-700 rounded-xl p-5">
              <EChart option={heatmapOption} height={heatmapHeight} />
            </div>
          </section>

          <section className="mb-10">
            <h2 className="text-orange-400 font-semibold text-lg mb-1">Grade Pyramid</h2>
            <p className="text-stone-500 text-sm mb-3">Even the Great Pyramid was built one session at a time.</p>
            <ChartFilters allBoards={allBoards} filter={pyramidFilter} onChange={setPyramidFilter} />
            <div className="bg-stone-900 border border-stone-700 rounded-xl p-5">
              <EChart option={pyramidOption} height={pyramidHeight} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
