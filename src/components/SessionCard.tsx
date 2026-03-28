import { Session } from "@/lib/types";
import { mockClimbs } from "@/lib/mock-data";
import GradeBadge from "./GradeBadge";

const FEEL_LABELS: Record<number, string> = {
  1: "Rough",
  2: "Meh",
  3: "Solid",
  4: "Strong",
  5: "Crushing",
};

export default function SessionCard({ session }: { session: Session }) {
  const sends = session.logEntries.filter((e) => e.sent).length;
  const totalAttempts = session.logEntries.reduce((s, e) => s + e.attempts, 0);

  return (
    <div className="bg-stone-800 border border-stone-700 rounded-xl p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-white font-semibold">
            {new Date(session.date).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </div>
          <div className="text-stone-400 text-sm mt-0.5">
            {session.boardType} · {session.angle}° · {session.durationMinutes} min
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-stone-300">
            {FEEL_LABELS[session.feelRating]}
          </div>
          <div className="text-xs text-stone-500 mt-0.5">
            {sends}/{session.logEntries.length} sends · {totalAttempts} attempts
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {session.logEntries.map((entry) => {
          const climb = mockClimbs.find((c) => c.id === entry.climbId);
          if (!climb) return null;
          return (
            <div
              key={entry.id}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${
                entry.sent
                  ? "bg-green-950 border-green-800 text-green-300"
                  : "bg-stone-700 border-stone-600 text-stone-300"
              }`}
            >
              <GradeBadge grade={climb.grade} />
              <span className="ml-1 truncate max-w-[120px]">{climb.name}</span>
              {entry.sent && <span className="text-green-400">✓</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
