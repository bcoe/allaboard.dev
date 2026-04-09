import { Grade } from "./types";

export const GRADE_COLORS: Record<string, string> = {
  V0:   "bg-green-700",
  V1:   "bg-green-600",
  V2:   "bg-green-500",
  V3:   "bg-lime-500",
  V4:   "bg-yellow-500",
  V5:   "bg-amber-500",
  "V5+":"bg-amber-600",
  V6:   "bg-orange-500",
  V7:   "bg-orange-600",
  V8:   "bg-red-500",
  "V8+":"bg-red-600",
  V9:   "bg-red-700",
  V10:  "bg-red-800",
  V11:  "bg-rose-700",
  V12:  "bg-purple-600",
  V13:  "bg-purple-700",
  V14:  "bg-pink-600",
  V15:  "bg-pink-700",
  V16:  "bg-fuchsia-800",
  V17:  "bg-fuchsia-950",
  V18:  "bg-black",
};

export const ALL_GRADES: Grade[] = [
  "V0","V1","V2","V3","V4","V5","V5+","V6","V7","V8","V8+",
  "V9","V10","V11","V12","V13","V14","V15","V16","V17","V18",
];

/** Numeric index for each grade, with V5+ and V8+ as half-steps. */
const GRADE_INDEX: Record<string, number> = {
  V0: 0, V1: 1, V2: 2, V3: 3, V4: 4,
  V5: 5, "V5+": 5.5, V6: 6, V7: 7, V8: 8, "V8+": 8.5,
  V9: 9, V10: 10, V11: 11, V12: 12, V13: 13,
  V14: 14, V15: 15, V16: 16, V17: 17, V18: 18,
};

/**
 * Points awarded for a tick at the given grade.
 * Formula: base = round(10 × 1.3^n); flash bonus = round(base × 0.20).
 * A "flash" is a send on the first attempt (attempts === 1).
 */
export function gradePoints(grade: string): { base: number; flash: number } {
  const n = GRADE_INDEX[grade];
  if (n === undefined) return { base: 0, flash: 0 };
  const base = Math.round(10 * 1.3 ** n);
  const flash = Math.round(base * 0.2);
  return { base, flash };
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}
