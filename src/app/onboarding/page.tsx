"use client";

import { useState, useEffect } from "react";

interface Board {
  id: string;
  name: string;
}

function toHandle(displayName: string): string {
  return displayName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 30);
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function OnboardingPage() {
  const [displayName, setDisplayName]           = useState("");
  const [handleStatus, setHandleStatus]         = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
  const [boardId, setBoardId]                   = useState<string>("");
  const [boards, setBoards]                     = useState<Board[]>([]);
  const [submitting, setSubmitting]             = useState(false);
  const [submitError, setSubmitError]           = useState("");

  const debouncedDisplayName = useDebounce(displayName, 400);
  const handle = toHandle(debouncedDisplayName);

  // Load boards once
  useEffect(() => {
    fetch("/api/boards")
      .then((r) => r.json())
      .then((data: Board[]) => {
        setBoards(data);
        if (data.length > 0) setBoardId(data[0].id);
      });
  }, []);

  // Check handle availability whenever the debounced name changes
  useEffect(() => {
    if (!debouncedDisplayName.trim()) {
      setHandleStatus("idle");
      return;
    }
    if (handle.length < 2) {
      setHandleStatus("invalid");
      return;
    }

    setHandleStatus("checking");
    fetch(`/api/users/check-handle?handle=${encodeURIComponent(handle)}`)
      .then((r) => r.json())
      .then(({ available, reason }: { available: boolean; reason?: string }) => {
        if (reason === "invalid_chars" || reason === "too_short") {
          setHandleStatus("invalid");
        } else {
          setHandleStatus(available ? "available" : "taken");
        }
      })
      .catch(() => setHandleStatus("idle"));
  }, [debouncedDisplayName, handle]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (handleStatus !== "available" || !boardId) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch("/api/onboarding", {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ displayName: displayName.trim(), boardId }),
      });
      if (res.ok) {
        // Hard navigation so AuthProvider remounts and re-fetches /api/auth/me
        window.location.href = "/";
      } else {
        const body = await res.json() as { error: string };
        setSubmitError(body.error ?? "Something went wrong");
      }
    } catch {
      setSubmitError("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = handleStatus === "available" && !!boardId && !submitting;

  return (
    <div className="max-w-md mx-auto py-16 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Welcome to allaboard</h1>
        <p className="text-stone-400 mt-2">Set up your profile to get started.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">

        {/* Display name */}
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">
            Display Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Alex Sends"
            maxLength={50}
            required
            className="w-full bg-stone-800 border border-stone-600 rounded-lg px-3 py-2.5 text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-500 transition-colors"
          />
          {/* Handle preview + availability */}
          <div className="mt-1.5 h-5 flex items-center gap-2">
            {displayName && (
              <span className="text-stone-500 text-xs">@{toHandle(displayName)}</span>
            )}
            {handleStatus === "checking" && (
              <span className="text-stone-500 text-xs">checking…</span>
            )}
            {handleStatus === "available" && (
              <span className="text-green-400 text-xs">Available</span>
            )}
            {handleStatus === "taken" && (
              <span className="text-red-400 text-xs">Already taken</span>
            )}
            {handleStatus === "invalid" && displayName.trim().length > 0 && (
              <span className="text-red-400 text-xs">Use letters, numbers and spaces only</span>
            )}
          </div>
        </div>

        {/* Default board */}
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">
            Home Board <span className="text-red-400">*</span>
          </label>
          <div className="flex flex-col gap-2">
            {boards.map((board) => (
              <label
                key={board.id}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${
                  boardId === board.id
                    ? "border-orange-500 bg-stone-800"
                    : "border-stone-700 bg-stone-900 hover:border-stone-500"
                }`}
              >
                <input
                  type="radio"
                  name="board"
                  value={board.id}
                  checked={boardId === board.id}
                  onChange={() => setBoardId(board.id)}
                  className="accent-orange-500"
                />
                <span className="text-white text-sm">{board.name}</span>
              </label>
            ))}
          </div>
        </div>

        {submitError && (
          <p className="text-red-400 text-sm">{submitError}</p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full bg-orange-500 hover:bg-orange-400 disabled:bg-stone-700 disabled:text-stone-500 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors"
        >
          {submitting ? "Setting up your profile…" : "Start climbing"}
        </button>
      </form>
    </div>
  );
}
