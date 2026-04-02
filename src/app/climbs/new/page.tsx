"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Grade, Board } from "@/lib/types";
import { createClimb } from "@/lib/db";
import { ALL_GRADES } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import Link from "next/link";

export default function NewClimbPage() {
  const router  = useRouter();
  const { user, loading } = useAuth();

  const [boards, setBoards]           = useState<Board[]>([]);
  const [boardId, setBoardId]         = useState<string>("");
  const selectedBoard                  = boards.find((b) => b.id === boardId);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState("");

  // Redirect unauthenticated users
  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [user, loading, router]);

  // Load boards and pre-select user's home board
  useEffect(() => {
    fetch("/api/boards")
      .then((r) => r.json())
      .then((loaded: Board[]) => {
        setBoards(loaded);
        if (user?.homeBoard) {
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
          <input
            type="text"
            name="setter"
            placeholder="e.g. Chris Sharma"
            className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-500 transition-colors"
          />
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
