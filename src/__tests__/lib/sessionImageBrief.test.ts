/**
 * @jest-environment node
 *
 * Tests for the text handed to the prompt model when drawing a session banner.
 *
 * This is where the "notes over climb names" weighting starts: the art
 * direction tells the model to prefer the notes, but only if the brief
 * actually labels them as notes and includes them in full.
 */

// The module pulls in the AI SDK at import time; none of it is exercised here.
jest.mock("ai", () => ({ generateText: jest.fn(), generateImage: jest.fn() }));
jest.mock("@ai-sdk/gateway", () => ({ gateway: Object.assign(jest.fn(), { imageModel: jest.fn() }) }));

import { buildSessionBrief } from "@/lib/server/sessionImage";
import type { UserTick } from "@/lib/types";

const tick = (over: Partial<UserTick> = {}): UserTick => ({
  id: "t1", climbId: "c1", climbName: "Argh", grade: "V6",
  boardName: "Kilter Board (Original)", angle: 40, rating: 4,
  sent: true, date: "2026-10-05T18:00:00.000Z", createdAt: "2026-10-05T18:00:00.000Z",
  ...over,
});

const session = { tickCount: 1, sentCount: 1, hardestGrade: "V6" as const, totalMinutes: 45 };

describe("buildSessionBrief", () => {
  it("labels the climb name and the note distinctly", () => {
    const brief = buildSessionBrief(session, [
      tick({ climbName: "Batman And Robin Climb", comment: "Got the bat hang on the last go." }),
    ]);

    expect(brief).toContain('Climb name: "Batman And Robin Climb"');
    expect(brief).toContain(`Climber's note: "Got the bat hang on the last go."`);
  });

  it("says so explicitly when a climb has no note", () => {
    expect(buildSessionBrief(session, [tick({ comment: undefined })]))
      .toContain("Climber's note: (none)");
  });

  it("summarises the session up front", () => {
    const brief = buildSessionBrief(
      { tickCount: 3, sentCount: 2, hardestGrade: "V8", totalMinutes: 90 },
      [tick()],
    );
    expect(brief.split("\n")[0]).toBe(
      "Session: 3 climbs logged, 2 sent, hardest send V8, 90 minutes on the wall.",
    );
  });

  it("omits the grade and duration when nothing was sent or timed", () => {
    const brief = buildSessionBrief(
      { tickCount: 2, sentCount: 0, hardestGrade: undefined, totalMinutes: undefined },
      [tick({ sent: false })],
    );
    expect(brief.split("\n")[0]).toBe("Session: 2 climbs logged, 0 sent.");
  });

  it("records attempts and whether the climb went down", () => {
    const brief = buildSessionBrief(session, [tick({ sent: false, attempts: 12 })]);
    expect(brief).toContain("(V6, not sent (still working it), 12 attempts)");
  });

  it("passes the climb's own description, a second source of motif", () => {
    const brief = buildSessionBrief(session, [tick({ description: "May awesome climb" })]);
    expect(brief).toContain('Climb description: "May awesome climb"');
  });

  it("passes the board, angle and star rating", () => {
    const brief = buildSessionBrief(session, [tick({ rating: 3 })]);
    expect(brief).toContain("Kilter Board (Original) at 40°");
    expect(brief).toContain("rated 3/4 by the climber");
  });

  it("passes a grade opinion only when it disagrees with the book grade", () => {
    expect(buildSessionBrief(session, [tick({ suggestedGrade: "V8" })]))
      .toContain("more like V8");
    expect(buildSessionBrief(session, [tick({ suggestedGrade: "V6" })]))
      .not.toContain("more like");
  });

  it("passes the minutes spent on a single climb", () => {
    expect(buildSessionBrief(session, [tick({ durationMinutes: 40 })]))
      .toContain("40 minutes on it");
  });

  it("gives a note-less session something to draw from beyond the name", () => {
    // The failure this guards: a one-climb session with no comment used to
    // reach the model as a name and a grade, which cannot supply the three
    // specific details the art direction asks for.
    const brief = buildSessionBrief(
      { tickCount: 1, sentCount: 1, hardestGrade: "V3", totalMinutes: undefined },
      [tick({ climbName: "batman and robin climb", grade: "V3", comment: undefined,
              description: "May awesome climb", rating: 4 })],
    );

    expect(brief).toContain("Climber's note: (none)");
    expect(brief).toContain('Climb description: "May awesome climb"');
    expect(brief).toContain("rated 4/4 by the climber");
    expect(brief).toContain("Kilter Board (Original) at 40°");
  });

  it("truncates a runaway climb description too", () => {
    const brief = buildSessionBrief(session, [tick({ description: "z".repeat(1000) })]);
    expect(brief).toContain("z".repeat(400) + "…");
  });

  it("truncates a runaway note rather than sending an essay to the model", () => {
    const brief = buildSessionBrief(session, [tick({ comment: "x".repeat(1000) })]);
    expect(brief).toContain("…");
    expect(brief.length).toBeLessThan(700);
  });

  it("keeps the climbs in logged order", () => {
    const brief = buildSessionBrief(session, [
      tick({ id: "t1", climbName: "First" }),
      tick({ id: "t2", climbName: "Second" }),
    ]);
    expect(brief.indexOf("First")).toBeLessThan(brief.indexOf("Second"));
    expect(brief).toContain('1. Climb name: "First"');
    expect(brief).toContain('2. Climb name: "Second"');
  });
});

// ── Error flattening ──────────────────────────────────────────────────────────
//
// The failure that prompted this: a row stored only "Invalid JSON response",
// which is not enough to tell a content rejection from an upstream outage.

import { describeError } from "@/lib/server/sessionImage";

describe("describeError", () => {
  it("keeps the plain message for an ordinary error", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  it("names the error type when it is a specific one", () => {
    const err = new Error("Invalid JSON response");
    err.name = "JSONParseError";
    expect(describeError(err)).toBe("JSONParseError: Invalid JSON response");
  });

  it("surfaces the upstream status and body, which is where the real reason lives", () => {
    const err = Object.assign(new Error("Invalid JSON response"), {
      statusCode: 502,
      responseBody: "<html>Bad Gateway</html>",
    });
    const out = describeError(err);
    expect(out).toContain("status=502");
    expect(out).toContain("Bad Gateway");
  });

  it("unwraps a nested cause", () => {
    const err = Object.assign(new Error("failed"), {
      cause: { message: "content policy violation", statusCode: 422 },
    });
    const out = describeError(err);
    expect(out).toContain("cause=content policy violation");
    expect(out).toContain("cause_status=422");
  });

  it("stays inside the column's 500-char budget", () => {
    const err = Object.assign(new Error("x".repeat(400)), {
      responseBody: "y".repeat(5000),
    });
    expect(describeError(err).length).toBeLessThanOrEqual(500);
  });

  it("handles a thrown non-Error", () => {
    expect(describeError("just a string")).toBe("just a string");
  });
});
