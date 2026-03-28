"use client";

import { useEffect, useState, useCallback } from "react";
import { ClimberStats } from "@/lib/types";
import { getCurrentUser, computeStats } from "@/lib/db";
import StatCard from "@/components/StatCard";
import GradePyramid from "@/components/GradePyramid";
import GradeBadge from "@/components/GradeBadge";

export default function StatsPage() {
  const [stats, setStats] = useState<ClimberStats | null>(null);

  const reload = useCallback(() => {
    void (async () => {
      const me = await getCurrentUser();
      setStats(await computeStats(me.id));
    })();
  }, []);

  useEffect(reload, [reload]);

  if (!stats) {
    return <div className="text-stone-500 text-center py-16">Loading…</div>;
  }

  const maxFreq = Math.max(...stats.sessionFrequency.map((w) => w.sessionCount), 1);
  const sendRate = stats.totalAttempts > 0
    ? ((stats.totalSends / stats.totalAttempts) * 100).toFixed(1)
    : "0.0";

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Stats</h1>
        <p className="text-stone-400 mt-1">Your climbing telemetry</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
        <StatCard label="Total Sends"   value={stats.totalSends}      accent="text-green-400" />
        <StatCard label="Total Attempts" value={stats.totalAttempts} />
        <StatCard label="Send Rate"      value={`${sendRate}%`}       accent="text-orange-400" />
        <StatCard
          label="Week Streak"
          value={`${stats.currentStreak}w`}
          sub="consecutive weeks"
          accent="text-yellow-400"
        />
      </div>

      {/* Grade Pyramid */}
      {stats.gradePyramid.length > 0 && (
        <section className="mb-10">
          <h2 className="text-white font-semibold text-lg mb-4">Grade Pyramid</h2>
          <div className="bg-stone-800 border border-stone-700 rounded-xl p-5">
            <GradePyramid rows={stats.gradePyramid} />
          </div>
        </section>
      )}

      {/* Session Frequency */}
      <section className="mb-10">
        <h2 className="text-white font-semibold text-lg mb-4">Session Frequency (last 12 weeks)</h2>
        <div className="bg-stone-800 border border-stone-700 rounded-xl p-5">
          <div className="flex items-end gap-1.5" style={{ height: "96px" }}>
            {stats.sessionFrequency.map(({ weekLabel, sessionCount }) => {
              const heightPct = sessionCount === 0 ? 4 : Math.round((sessionCount / maxFreq) * 100);
              return (
                <div key={weekLabel} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end" style={{ height: "72px" }}>
                    <div
                      className={`w-full rounded-t transition-all ${
                        sessionCount > 0 ? "bg-orange-500" : "bg-stone-700"
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                  <span className="text-stone-500 text-[9px] rotate-45 origin-left translate-x-1 whitespace-nowrap">
                    {weekLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Progress Over Time */}
      {stats.progressOverTime.length > 0 && (
        <section className="mb-10">
          <h2 className="text-white font-semibold text-lg mb-4">Progress Over Time</h2>
          <div className="bg-stone-800 border border-stone-700 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-700 text-stone-400 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Month</th>
                  <th className="text-left px-4 py-3">Highest Grade</th>
                  <th className="text-right px-4 py-3">Sends</th>
                </tr>
              </thead>
              <tbody>
                {stats.progressOverTime.map(({ month, highestGradeSent, totalSends }, i) => (
                  <tr key={month} className={`border-b border-stone-700/50 ${i % 2 ? "bg-stone-800/50" : ""}`}>
                    <td className="px-4 py-3 text-stone-300">{month}</td>
                    <td className="px-4 py-3"><GradeBadge grade={highestGradeSent} /></td>
                    <td className="px-4 py-3 text-right text-green-400 font-medium">{totalSends}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Attempts vs Sends */}
      {stats.attemptsVsSends.length > 0 && (
        <section className="mb-10">
          <h2 className="text-white font-semibold text-lg mb-4">Attempts vs Sends</h2>
          <div className="bg-stone-800 border border-stone-700 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-700 text-stone-400 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Climb</th>
                  <th className="text-left px-4 py-3">Grade</th>
                  <th className="text-right px-4 py-3">Attempts</th>
                  <th className="text-right px-4 py-3">Sends</th>
                  <th className="text-right px-4 py-3">Rate</th>
                </tr>
              </thead>
              <tbody>
                {stats.attemptsVsSends.map(({ climbId, climbName, grade, attempts, sends }) => {
                  const rate = attempts > 0 ? ((sends / attempts) * 100).toFixed(0) : "0";
                  return (
                    <tr key={climbId} className="border-b border-stone-700/50">
                      <td className="px-4 py-3 text-stone-200 font-medium">{climbName}</td>
                      <td className="px-4 py-3"><GradeBadge grade={grade} /></td>
                      <td className="px-4 py-3 text-right text-stone-300">{attempts}</td>
                      <td className="px-4 py-3 text-right text-green-400 font-medium">{sends}</td>
                      <td className="px-4 py-3 text-right text-stone-400">{rate}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
