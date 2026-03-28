import { GRADE_COLORS } from "@/lib/utils";
import { Grade } from "@/lib/types";

interface PyramidRow {
  grade: Grade;
  sends: number;
}

export default function GradePyramid({ rows }: { rows: PyramidRow[] }) {
  const max = Math.max(...rows.map((r) => r.sends), 1);

  return (
    <div className="flex flex-col gap-2">
      {rows.map(({ grade, sends }) => {
        const pct = Math.round((sends / max) * 100);
        const color = GRADE_COLORS[grade] ?? "bg-stone-600";
        return (
          <div key={grade} className="flex items-center gap-3">
            <div className="w-8 text-xs text-stone-400 text-right shrink-0">{grade}</div>
            <div className="flex-1 h-6 bg-stone-800 rounded overflow-hidden">
              <div
                className={`h-full ${color} rounded transition-all`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="w-6 text-xs text-stone-400 shrink-0">{sends}</div>
          </div>
        );
      })}
    </div>
  );
}
