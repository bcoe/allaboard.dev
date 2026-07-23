import type { TickSessionDetail } from "@/lib/types";
import { sessionTitle, formatDuration } from "@/lib/utils";

/**
 * Builds a plain-text summary of a session, suitable for pasting to a coach.
 *
 * Lists the climbs in the order they were logged, with each climb's grade,
 * name, whether it was sent or still being worked, and the time spent working
 * it (when recorded), followed by the climber's comment (when present) on its
 * own indented line. Example:
 *
 * ```
 * Session October 5th 2026
 *
 * 1. V5 — Crimp Master (Sent, 30m)
 *    Sticky feet, felt solid.
 * 2. V6 — Slopey Nightmare (Working)
 *    Couldn't stick the throw to the lip.
 * ```
 */
export function buildSessionSummaryText(session: TickSessionDetail): string {
  const lines: string[] = [sessionTitle(session.date, session.sessionNumber), ""];

  session.ticks.forEach((tick, i) => {
    const status = tick.sent ? "Sent" : "Working";
    const meta = tick.durationMinutes != null
      ? `${status}, ${formatDuration(tick.durationMinutes)}`
      : status;
    lines.push(`${i + 1}. ${tick.grade} — ${tick.climbName} (${meta})`);
    const comment = tick.comment?.trim();
    if (comment) lines.push(`   ${comment}`);
  });

  return lines.join("\n");
}
