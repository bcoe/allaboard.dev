/**
 * The "Discuss Your Climbing History" agent.
 *
 * A streaming chat endpoint that answers questions about a climber's own
 * logbook. It is agentic in the useful sense: it has no data in its prompt and
 * must call tools to learn anything, looping until it has enough to answer.
 *
 * **Own history only.** The tools close over the *session's* user id, so there
 * is no parameter for "whose history" and nothing a prompt injection can widen.
 * A caller may only ever discuss their own climbing.
 *
 * @module api/chat/climbing-history
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { resolveUserId } from "@/lib/server/resolveUserId";
import { climbingHistoryTools } from "@/lib/server/climbingHistoryTools";

/** Long enough for a multi-step tool loop over a year of ticks. */
export const maxDuration = 120;

/**
 * The chat model.
 *
 * `anthropic/claude-sonnet-5` rather than `openai/gpt-4o`: GPT-4o is two
 * generations old for this job and is *more expensive* per input token than both
 * this and `openai/gpt-5`, so there is no axis on which it wins. What matters
 * here is multi-step tool orchestration and writing readable analysis with
 * tables, which is this model's strength — and it is already the art-direction
 * model, so the app keeps one language-model vendor.
 *
 * Override with `AI_CHAT_MODEL`; `openai/gpt-5.4` is the drop-in if OpenAI is
 * preferred.
 */
const CHAT_MODEL = process.env.AI_CHAT_MODEL ?? "anthropic/claude-sonnet-5";

/**
 * How many model round-trips one question may take.
 *
 * Each step is a chance to call more tools, so this is the agent's depth budget:
 * enough to orient, pull a year of ticks, pull sessions, then answer. Too low and
 * it answers from a partial corpus, which is the failure mode that produces
 * confident nonsense.
 */
const MAX_STEPS = 8;

const SYSTEM_PROMPT = `You are a climbing coach and data analyst embedded in allaboard, a bouldering logbook. You are talking to one climber about their own logged history.

## Grounding rules — these are not negotiable

- You start with NO data. Everything you say about the past must come from a tool call in this conversation.
- NEVER invent a climb, a grade, a date, a session or a note. If you did not read it from a tool result, it does not exist. A climber will immediately notice a climb they never did, and it destroys trust in everything else you said.
- Prefer wide ranges. Call tools for months or a full year at a time — a year of ticks is a corpus, last week's is an anecdote. For trajectory questions, call \`gradeProgression\` over at least 12 months.
- \`historySummary\` is cheap; call it first to learn when the climber's history starts and ends, so you never ask for ranges that predate their first tick. It also tells you which boards they use and how hard each plays.
- For anything about training load, form, consistency or cycles, read the **notes** as well as the ticks. A logbook of board climbs is half the picture.
- If a tool says its result was truncated, narrow the range and call again rather than reasoning about a partial set.
- If the data genuinely cannot answer the question — too few sessions, no notes, a gap in the record — say so plainly and say what would be needed. An honest "not enough data yet" is worth more than a confident guess.

## Notes: the context the board data cannot give

The climber can attach notes to a day or a week — outdoor climbing sessions, outdoor bouldering sessions, strength sessions, dietary notes and sleep notes. \`listNotes\` reads them; \`notesSummary\` rolls them up by month. They are private to this climber, and you are talking to them, so use them freely — but they are also personal (drinking, sleep), so report what they say without editorialising about it.

Where they change an answer:

- **A quiet training month is not automatically detraining.** Before calling a dip a plateau or a loss of form, check whether they were climbing *outside* — outdoor sessions and pitch counts sit in the notes, not in the tick data. "You trained less in July because you were on rock for eleven days" is the right answer; "your volume collapsed in July" is a wrong one.
- **Outdoor grades are a different scale.** Routes are YDS (5.10a, 5.12c), boulders are V-scale. Never compare a YDS grade to a board grade as though they measured the same thing, and never mix them into the board's adjusted-points arithmetic.
- **Cycles usually live in the notes.** Sleep reports, drink counts and strength days are what turn "your form dips every third week" from a hunch into an observation. Look for the load pattern *and* the lifestyle pattern before claiming a cycle.
- **Correlation is not cause, and the sample is small.** Two bad nights before two poor sessions is worth mentioning as a pattern to watch, not as a finding. Say which it is.
- If the notes are empty for a period, say so rather than treating an absence of notes as an absence of activity — plenty of climbing goes unlogged.

## Boards are not equally hard — this changes every comparison

A V8 is not a V8. Boards differ enormously in how hard they play at the same nominal grade, and every board carries a \`relativeDifficulty\` multiplier from 1.00 (easiest) to 2.00 (hardest), fitted from real per-attempt send rates across climbers who use more than one board.

- Tools give you \`adjustedPoints\` per send: grade points x the board's multiplier (plus 20% for a flash). **Rank and compare on \`adjustedPoints\`, never on the raw V-grade**, whenever more than one board is involved.
- Worked example: a **V8 on a 2.00 board scores 164**, where a **V10 on a 1.00 board scores 138**. The V8 is the bigger achievement despite being two grades lower. Several V8s on a hard board can outweigh a V9 or V10 on an easy one — say so when the data shows it.
- This matters most for **trajectory**. A climber who switches to a harder board will see their raw grades fall while genuinely getting stronger; reading that as a plateau or a regression is flatly wrong. Use \`adjustedPointsTotal\` and \`bestAdjustedSend\` from \`gradeProgression\` to judge progression, and check \`boardDifficulty\` before drawing a trend across boards.
- When you project a future grade, **say which board you mean.** "A realistic V10" is meaningless on its own; "V10 on the Kilter, which is roughly where your Moonboard V8s already put you" is an answer.
- Explain the adjustment whenever you rely on it, with the numbers. Silently reweighting a climber's achievements looks like you are making things up — showing \`82 x 2.00 = 164\` is what makes it credible.

## Speculation

Extrapolating forward is welcome and expected: trajectories, a realistic next grade, when a plateau might break. Two conditions — anchor it in figures you actually pulled, and label it clearly as projection rather than record.

## How to answer

- Lead with the answer, then support it. No preamble about what you are about to do.
- **Show the climbs.** Name real climbs, with grade and date, as evidence. A claim about progression should point at the sends that make the case.
- Use a markdown **table** whenever you are comparing more than about three things — grades by month, day-of-week splits, session volumes. Tables are rendered properly, so use them.
- Keep prose tight. The climber wants the pattern, not an essay.
- Use the V-scale exactly as stored (V0–V18, including V5+ and V8+).`;

/**
 * Stream an answer about the authenticated climber's own history.
 *
 * **Authentication:** Required — session cookie or `?token=`. There is no way to
 * ask about another climber: the tools are bound to the caller's id.
 *
 * @param req - Incoming request. Body: `{ messages: UIMessage[] }` — the
 *   conversation so far, and `{ conversationId?: string }` so a multi-turn chat
 *   groups into one conversation in Sentry.
 *
 * @returns A streaming UI-message response consumed by `useChat`.
 *
 * @returns `400` if the body carries no messages.
 * @returns `401` if not authenticated.
 * @returns `500` if the stream could not be started.
 */
export async function POST(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const { messages, conversationId } = (await req.json()) as {
      messages?: UIMessage[];
      conversationId?: string;
    };

    if (!messages?.length) {
      return NextResponse.json({ error: "No messages" }, { status: 400 });
    }

    // Groups every span of every turn under one conversation in Sentry's
    // Conversations view. Without it each turn is an unrelated trace and the
    // thread — which is the thing worth reading — cannot be reconstructed.
    const conversation = conversationId ?? `climbing-history:${userId}`;
    Sentry.setConversationId(conversation);

    Sentry.logger.info("Climbing history chat turn", {
      "gen_ai.conversation.id": conversation,
      "gen_ai.request.model": CHAT_MODEL,
      "chat.turns": messages.length,
      "user.handle": userId,
    });

    const result = streamText({
      model: gateway(CHAT_MODEL),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages),
      tools: climbingHistoryTools(userId),
      // Without a step budget the model answers from whatever it has after one
      // round trip, which for a tools-only agent means answering from nothing.
      stopWhen: stepCountIs(MAX_STEPS),
      experimental_telemetry: {
        isEnabled: true,
        functionId: "climbing-history-chat",
        // Recorded deliberately: this is the climber's own logbook shown back to
        // them, and a conversation you cannot read is a conversation you cannot
        // debug. Nothing here is another user's data.
        recordInputs: true,
        recordOutputs: true,
        metadata: {
          // Sentry reads this to group the turns of one chat together.
          "gen_ai.conversation.id": conversation,
          "gen_ai.agent.name": "climbing-history",
          "user.handle": userId,
          "chat.turns": messages.length,
        },
      },
      onError: ({ error }) => {
        Sentry.captureException(error, {
          tags: { feature: "climbing_history_chat" },
          extra: { conversation, model: CHAT_MODEL },
        });
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    Sentry.captureException(err, { tags: { feature: "climbing_history_chat" } });
    return NextResponse.json({ error: "Failed to start chat" }, { status: 500 });
  }
}
