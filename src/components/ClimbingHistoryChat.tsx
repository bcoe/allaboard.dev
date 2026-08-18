"use client";

/**
 * "Discuss Your Climbing History" — the agent chat at the foot of a climber's
 * detailed stats page.
 *
 * Only ever rendered for a climber looking at their *own* stats; the endpoint
 * enforces the same rule server-side, since a hidden component is not access
 * control.
 *
 * Built on the AI SDK's `useChat` with hand-rolled presentation rather than AI
 * Elements. AI Elements is a shadcn/ui generator, and this project has no
 * shadcn, no Radix and no `cva` — adopting it would install a second design
 * system alongside the hand-rolled Tailwind one and leave the chat looking
 * foreign on its own page. `streamdown` (the markdown renderer AI Elements uses)
 * is here, because rendering tables well is a stated requirement and streaming
 * markdown is genuinely fiddly.
 */

import { useId, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Streamdown } from "streamdown";

/** Openers, because a blank chat box is a hard thing to start talking to. */
const SUGGESTIONS = [
  "What trajectory am I on — what's a realistic hardest grade for me?",
  "What days of the week am I strongest on?",
  "What's the hardest climb I've sent this year?",
  "Do you notice any cycles in my climbing?",
];

/** Human label for a tool call, so the transcript reads as work being done. */
const TOOL_LABELS: Record<string, string> = {
  listTicks: "Reading your ticks",
  listSessions: "Reading your sessions",
  gradeProgression: "Charting your progression",
  historySummary: "Sizing up your logbook",
};

export default function ClimbingHistoryChat({ handle }: { handle: string }) {
  // One id per mounted chat groups its turns into a single conversation in
  // Sentry, rather than one orphan trace per question. `useId` rather than a
  // timestamp: stable across re-renders, and pure, so it survives a re-render
  // during streaming without splitting the conversation in two.
  const conversationId = `climbing-history:${handle}:${useId()}`;
  const [input, setInput] = useState("");

  const { messages, sendMessage, status, error, stop } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat/climbing-history",
      body: { conversationId },
    }),
  });

  const busy = status === "submitted" || status === "streaming";

  function ask(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setInput("");
    void sendMessage({ text: question });
  }

  return (
    <section className="mt-10">
      <h2 className="text-orange-400 font-semibold text-lg mb-1">
        Discuss Your Climbing History
      </h2>
      <p className="text-stone-500 text-sm mb-3">
        Ask about your own logbook. Answers are read from your real ticks — projections
        are labelled as such.
      </p>

      <div className="bg-stone-900 border border-stone-700 rounded-xl overflow-hidden">
        <div className="max-h-[32rem] overflow-y-auto p-5 space-y-5">
          {messages.length === 0 ? (
            <div className="space-y-3">
              <p className="text-stone-400 text-sm">A few things worth asking:</p>
              <div className="flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    className="text-left text-sm text-stone-300 bg-stone-800 hover:bg-stone-750 hover:text-orange-400 border border-stone-700 rounded-lg px-3 py-2 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => <Message key={m.id} message={m} />)
          )}

          {status === "submitted" && (
            <p className="text-stone-500 text-sm animate-pulse">Reading your logbook…</p>
          )}

          {error && (
            <p className="text-red-400 text-sm">
              Something went wrong reading your history. Try asking again.
            </p>
          )}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); ask(input) }}
          className="border-t border-stone-700 p-3 flex items-center gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your climbing…"
            aria-label="Ask about your climbing history"
            className="flex-1 bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-500"
          />
          {busy ? (
            <button
              type="button"
              onClick={stop}
              className="shrink-0 px-3 py-2 bg-stone-700 hover:bg-stone-600 text-white text-xs font-medium rounded-lg transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="shrink-0 px-3 py-2 bg-orange-500 hover:bg-orange-400 disabled:bg-stone-700 disabled:text-stone-500 text-white text-xs font-medium rounded-lg transition-colors"
            >
              Ask
            </button>
          )}
        </form>
      </div>
    </section>
  );
}

/**
 * One turn.
 *
 * A message is a list of parts, and tool calls are parts too — surfaced here as
 * a quiet line rather than hidden, because "Reading your ticks" is what makes a
 * 20-second pause legible as work rather than as a hang.
 */
function Message({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={isUser ? "flex justify-end" : ""}>
      <div
        className={
          isUser
            ? "max-w-[85%] bg-stone-800 border border-stone-700 rounded-xl px-3 py-2 text-sm text-white"
            : "w-full text-sm text-stone-300 leading-relaxed"
        }
      >
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return isUser ? (
              <span key={i}>{part.text}</span>
            ) : (
              // Tables, lists and emphasis are load-bearing in these answers.
              <Streamdown
                key={i}
                className="prose-chat"
                parseIncompleteMarkdown
              >
                {part.text}
              </Streamdown>
            );
          }

          if (part.type.startsWith("tool-")) {
            const name = part.type.slice("tool-".length);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const done = (part as any).state === "output-available";
            return (
              <p key={i} className="text-stone-500 text-xs my-1 flex items-center gap-1.5">
                <span className={done ? "text-green-500" : "text-orange-400 animate-pulse"}>
                  {done ? "✓" : "•"}
                </span>
                {TOOL_LABELS[name] ?? name}
              </p>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}
