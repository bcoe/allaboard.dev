import db from "./db";
import type { Grade } from "../../src/lib/types";

const GRADE_ORDER: Grade[] = [
  "V0","V1","V2","V3","V4","V5","V6","V7","V8",
  "V9","V10","V11","V12","V13","V14","V15","V16",
];

function gradeIndex(g: string): number {
  return GRADE_ORDER.indexOf(g as Grade);
}

export async function computeStats(userId: string) {
  const sessions = await db("sessions").where({ user_id: userId }).orderBy("date");
  if (!sessions.length) {
    return {
      userId,
      gradePyramid: [], sessionFrequency: [], progressOverTime: [],
      attemptsVsSends: [], totalSends: 0, totalAttempts: 0, currentStreak: 0,
    };
  }

  const sessionIds = sessions.map((s) => s.id);
  const entries = await db("log_entries")
    .whereIn("session_id", sessionIds)
    .join("climbs", "log_entries.climb_id", "climbs.id")
    .select("log_entries.*", "climbs.grade as climb_grade", "climbs.name as climb_name");

  // Grade pyramid — count sends per grade
  const sendsByGrade: Record<string, number> = {};
  for (const e of entries) {
    if (e.sent) sendsByGrade[e.climb_grade] = (sendsByGrade[e.climb_grade] ?? 0) + 1;
  }
  const gradePyramid = Object.entries(sendsByGrade)
    .sort(([a], [b]) => gradeIndex(b) - gradeIndex(a))
    .map(([grade, sends]) => ({ grade: grade as Grade, sends }));

  // Session frequency — group by ISO week (Mon)
  function isoWeekMonday(dateStr: string): string {
    const d = new Date(dateStr);
    const day = d.getUTCDay(); // 0=Sun
    const diff = (day === 0 ? -6 : 1 - day);
    const mon = new Date(d);
    mon.setUTCDate(d.getUTCDate() + diff);
    return mon.toISOString().slice(0, 10);
  }
  const countByWeek: Record<string, number> = {};
  for (const s of sessions) {
    const w = isoWeekMonday(s.date);
    countByWeek[w] = (countByWeek[w] ?? 0) + 1;
  }
  const sessionFrequency = Object.entries(countByWeek)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([isoDate, sessionCount]) => {
      const d = new Date(isoDate);
      const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      return { weekLabel: label, sessionCount };
    });

  // Progress over time — group by month
  const sendsByMonth: Record<string, { highestIdx: number; total: number }> = {};
  for (const e of entries) {
    if (!e.sent) continue;
    const month = e.date.slice(0, 7); // "YYYY-MM"
    if (!sendsByMonth[month]) sendsByMonth[month] = { highestIdx: -1, total: 0 };
    sendsByMonth[month].total += 1;
    const idx = gradeIndex(e.climb_grade);
    if (idx > sendsByMonth[month].highestIdx) sendsByMonth[month].highestIdx = idx;
  }
  const progressOverTime = Object.entries(sendsByMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, { highestIdx, total }]) => {
      const [year, month] = ym.split("-");
      const label = new Date(Number(year), Number(month) - 1, 1)
        .toLocaleDateString("en-US", { month: "short", year: "numeric" });
      return { month: label, highestGradeSent: GRADE_ORDER[highestIdx], totalSends: total };
    });

  // Attempts vs sends — per climb
  const statsByClimb: Record<string, { name: string; grade: string; attempts: number; sends: number }> = {};
  for (const e of entries) {
    if (!statsByClimb[e.climb_id]) {
      statsByClimb[e.climb_id] = { name: e.climb_name, grade: e.climb_grade, attempts: 0, sends: 0 };
    }
    statsByClimb[e.climb_id].attempts += e.attempts;
    if (e.sent) statsByClimb[e.climb_id].sends += 1;
  }
  const attemptsVsSends = Object.entries(statsByClimb).map(([climbId, s]) => ({
    climbId, climbName: s.name, grade: s.grade as Grade, attempts: s.attempts, sends: s.sends,
  }));

  const totalSends = entries.filter((e) => e.sent).length;
  const totalAttempts = entries.reduce((acc, e) => acc + e.attempts, 0);

  // Current streak — consecutive weeks with at least one session, counting back from most recent
  const weekSet = new Set(Object.keys(countByWeek));
  let streak = 0;
  const now = new Date();
  let cursor = new Date(isoWeekMonday(now.toISOString().slice(0, 10)));
  while (weekSet.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }

  return { userId, gradePyramid, sessionFrequency, progressOverTime, attemptsVsSends, totalSends, totalAttempts, currentStreak: streak };
}
