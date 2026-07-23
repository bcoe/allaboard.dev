import { buildSessionSummaryText } from "@/lib/sessionSummary";
import type { TickSessionDetail, UserTick } from "@/lib/types";

function tick(overrides: Partial<UserTick>): UserTick {
  return {
    id: "t",
    climbId: "c",
    climbName: "A Climb",
    grade: "V4",
    boardName: "Kilter Board (Original)",
    angle: 40,
    rating: 3,
    sent: true,
    date: "2026-10-05T18:00:00.000Z",
    createdAt: "2026-10-05T18:00:00.000Z",
    ...overrides,
  };
}

function session(ticks: UserTick[], sessionNumber = 1): TickSessionDetail {
  return {
    id: `bc-2026-10-05-${sessionNumber}`,
    userId: "bc",
    date: "2026-10-05",
    sessionNumber,
    startedAt: "2026-10-05T18:00:00.000Z",
    endedAt: "2026-10-05T19:30:00.000Z",
    tickCount: ticks.length,
    sentCount: ticks.filter((t) => t.sent).length,
    ticks,
  };
}

describe("buildSessionSummaryText", () => {
  it("starts with the session title", () => {
    const text = buildSessionSummaryText(session([tick({})]));
    expect(text.split("\n")[0]).toBe("Session October 5th 2026");
  });

  it("adds the per-day 'Session N' suffix for later sessions", () => {
    const text = buildSessionSummaryText(session([tick({})], 2));
    expect(text.split("\n")[0]).toBe("Session October 5th 2026 Session 2");
  });

  it("lists climbs in order with grade, name, and sent/working status", () => {
    const text = buildSessionSummaryText(
      session([
        tick({ id: "1", grade: "V5", climbName: "Crimp Master", sent: true, comment: undefined }),
        tick({ id: "2", grade: "V6", climbName: "Slopey Nightmare", sent: false, comment: undefined }),
      ]),
    );
    expect(text).toContain("1. V5 — Crimp Master (Sent)");
    expect(text).toContain("2. V6 — Slopey Nightmare (Working)");
  });

  it("includes the time spent working each climb when recorded", () => {
    const text = buildSessionSummaryText(
      session([
        tick({ id: "1", grade: "V5", climbName: "Crimp Master", sent: true, durationMinutes: 30, comment: undefined }),
        tick({ id: "2", grade: "V6", climbName: "Slopey Nightmare", sent: false, durationMinutes: 90, comment: undefined }),
        tick({ id: "3", grade: "V4", climbName: "Untimed Slab", sent: true, durationMinutes: undefined, comment: undefined }),
      ]),
    );
    expect(text).toContain("1. V5 — Crimp Master (Sent, 30m)");
    expect(text).toContain("2. V6 — Slopey Nightmare (Working, 1h 30m)");
    expect(text).toContain("3. V4 — Untimed Slab (Sent)"); // no time appended when unrecorded
  });

  it("includes a comment on its own line when present, and omits it otherwise", () => {
    const withComment = buildSessionSummaryText(
      session([tick({ comment: "sticky feet" })]),
    );
    expect(withComment).toContain("   sticky feet");

    const withoutComment = buildSessionSummaryText(
      session([tick({ comment: undefined })]),
    );
    expect(withoutComment.trim().split("\n")).toHaveLength(3); // title, blank, one climb line
  });
});
