import { Grade } from "@/lib/types";
import { GRADE_COLORS } from "@/lib/utils";

export default function GradeBadge({ grade, size = "sm" }: { grade: Grade; size?: "sm" | "md" }) {
  const color = GRADE_COLORS[grade] ?? "bg-stone-600";
  const padding = size === "md" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs";
  return (
    <span className={`${color} ${padding} text-white font-bold rounded`}>{grade}</span>
  );
}
