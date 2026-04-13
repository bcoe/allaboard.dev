"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Grade, Board } from "@/lib/types";
import { createClimb } from "@/lib/db";
import { ALL_GRADES } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import Link from "next/link";

// ── Setter typeahead ───────────────────────────────────────────────────────────

interface SetterInputProps {
  defaultValue?: string;
}

function SetterInput({ defaultValue = "" }: SetterInputProps) {
  const [value, setValue]           = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen]             = useState(false);
  const [activeIdx, setActiveIdx]   = useState(-1);
  const containerRef                = useRef<HTMLDivElement>(null);
  const debounceRef                 = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = useCallback((q: string) => {
    if (!q.trim()) { setSuggestions([]); setOpen(false); return; }
    fetch(`/api/setters?q=${encodeURIComponent(q)}&limit=8`)
      .then((r) => r.json())
      .then((names: string[]) => {
        setSuggestions(names);
        setOpen(names.length > 0);
        setActiveIdx(-1);
      })
      .catch(() => {});
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setValue(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(v), 180);
  }

  function pick(name: string) {
    setValue(name);
    setSuggestions([]);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      pick(suggestions[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // Close on outside click/touch
  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        name="setter"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        placeholder="e.g. Chris Sharma"
        autoComplete="off"
        className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-500 transition-colors"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 w-full mt-1 bg-stone-800 border border-stone-700 rounded-lg shadow-2xl overflow-hidden">
          {suggestions.map((name, i) => (
            <li
              key={name}
              onMouseDown={() => pick(name)}
              onMouseEnter={() => setActiveIdx(i)}
              className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                i === activeIdx
                  ? "bg-stone-700 text-white"
                  : "text-stone-200 hover:bg-stone-700"
              }`}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function NewClimbPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const initialName    = searchParams.get("name") ?? "";
  const initialBoardId = searchParams.get("boardId") ?? "";
  const { user, loading } = useAuth();

  const [boards, setBoards]         = useState<Board[]>([]);
  const [boardId, setBoardId]       = useState<string>("");
  const selectedBoard                = boards.find((b) => b.id === boardId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState("");

  // Redirect unauthenticated users
  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [user, loading, router]);

  // Load boards and pre-select: URL boardId param → user's home board → nothing
  useEffect(() => {
    fetch("/api/boards")
      .then((r) => r.json())
      .then((loaded: Board[]) => {
        setBoards(loaded);
        if (initialBoardId && loaded.find((b) => b.id === initialBoardId)) {
          setBoardId(initialBoardId);
        } else if (user?.homeBoard) {
          const match = loaded.find((b) => b.name === user.homeBoard);
          if (match) setBoardId(match.id);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const fd = new FormData(e.currentTarget);

    try {
      const isSprayWall = selectedBoard?.type === "spray_wall";
      const climb = await createClimb({
        name:        (fd.get("name") as string).trim(),
        grade:       fd.get("grade") as Grade,
        boardId,
        angle:       isSprayWall ? undefined : (fd.get("angle") ? Number(fd.get("angle")) : 40),
        description: (fd.get("description") as string).trim(),
        setter:      (fd.get("setter") as string).trim() || undefined,
      });
      router.push(`/climbs/${climb.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("409")) {
        setError("A climb with this name, grade, angle and board already exists.");
      } else {
        setError("Failed to submit climb. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !user) {
    return <div className="text-stone-500 text-center py-16">Loading…</div>;
  }

  return (
    <div className="max-w-xl mx-auto">
      <Link
        href="/climbs"
        className="text-stone-400 hover:text-white text-sm transition-colors mb-6 inline-flex items-center gap-1"
      >
        ← Back to climbs
      </Link>

      <div className="mt-4 mb-8">
        <h1 className="text-3xl font-bold text-white">Submit a Climb</h1>
        <p className="text-stone-400 mt-1">Add a new problem to the database</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">

        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">
            Climb Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            name="name"
            required
            defaultValue={initialName}
            placeholder="e.g. The Crimson Project"
            className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-500 transition-colors"
          />
        </div>

        {/* Grade + Angle */}
        <div className={selectedBoard?.type === "spray_wall" ? "" : "grid grid-cols-2 gap-4"}>
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1.5">
              Grade <span className="text-red-400">*</span>
            </label>
            <select
              name="grade"
              required
              className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-orange-500 transition-colors"
            >
              <option value="">Select grade</option>
              {ALL_GRADES.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          {selectedBoard?.type !== "spray_wall" && (
            <div>
              <label className="block text-sm font-medium text-stone-300 mb-1.5">
                Angle (degrees)
              </label>
              <input
                type="number"
                name="angle"
                min={0}
                max={90}
                defaultValue={40}
                className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-500 transition-colors"
              />
            </div>
          )}
        </div>

        {/* Board */}
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">
            Board <span className="text-red-400">*</span>
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
                  name="boardId"
                  value={board.id}
                  checked={boardId === board.id}
                  onChange={() => setBoardId(board.id)}
                  required
                  className="accent-orange-500"
                />
                <span className="text-white text-sm">{board.name}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Setter */}
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">
            Setter
            <span className="text-stone-500 font-normal ml-1">(optional — free-form name)</span>
          </label>
          <SetterInput />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">
            Description / Beta
            <span className="text-stone-500 font-normal ml-1">(optional)</span>
          </label>
          <textarea
            name="description"
            rows={4}
            placeholder="Describe the moves, crux, holds, and any beta that helped you…"
            className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-500 transition-colors resize-none"
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-orange-500 hover:bg-orange-400 disabled:bg-stone-700 disabled:text-stone-500 text-white font-semibold py-3 rounded-lg transition-colors mt-2"
        >
          {submitting ? "Submitting…" : "Submit Climb"}
        </button>
      </form>
    </div>
  );
}
