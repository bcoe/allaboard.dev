import { Grade } from "./types";

export const GRADE_COLORS: Record<string, string> = {
  V0: "bg-green-700",
  V1: "bg-green-600",
  V2: "bg-green-500",
  V3: "bg-lime-500",
  V4: "bg-yellow-500",
  V5: "bg-amber-500",
  V6: "bg-orange-500",
  V7: "bg-orange-600",
  V8: "bg-red-500",
  V9: "bg-red-600",
  V10: "bg-red-700",
  V11: "bg-rose-700",
  V12: "bg-purple-600",
  V13: "bg-purple-700",
  V14: "bg-pink-600",
  V15: "bg-pink-700",
  V16: "bg-fuchsia-800",
};

export const ALL_GRADES: Grade[] = [
  "V0","V1","V2","V3","V4","V5","V6","V7","V8",
  "V9","V10","V11","V12","V13","V14","V15","V16",
];

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
