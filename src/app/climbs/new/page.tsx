"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BoardType, Grade } from "@/lib/types";
import { createClimb } from "@/lib/db";
import { ALL_GRADES } from "@/lib/utils";
import Link from "next/link";

const BOARDS: BoardType[] = ["Kilter", "Moonboard"];

export default function NewClimbPage() {
  const router = useRouter();
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await createClimb({
      name:        fd.get("name") as string,
      grade:       fd.get("grade") as Grade,
      boardType:   fd.get("boardType") as BoardType,
      angle:       fd.get("angle") ? Number(fd.get("angle")) : undefined,
      description: fd.get("description") as string,
      sends:       fd.get("sends") ? Number(fd.get("sends")) : undefined,
    });
    setSubmitted(true);
    setTimeout(() => router.push("/climbs"), 1200);
  }

  if (submitted) {
    return (
      <div className="max-w-xl mx-auto text-center py-16">
        <div className="text-4xl mb-4">🎉</div>
        <h2 className="text-2xl font-bold text-white">Climb submitted!</h2>
        <p className="text-stone-400 mt-2">Redirecting back to the climbs list…</p>
      </div>
    );
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

        <div className="grid grid-cols-2 gap-4">
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
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1.5">
              Board Type <span className="text-red-400">*</span>
            </label>
            <select
              name="boardType"
              required
              className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-orange-500 transition-colors"
            >
              <option value="">Select board</option>
              {BOARDS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">
            Board Angle (degrees)
          </label>
          <input
            type="number"
            name="angle"
            min={0}
            max={70}
            placeholder="e.g. 40"
            className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-500 transition-colors"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">
            Description / Beta <span className="text-red-400">*</span>
          </label>
          <textarea
            name="description"
            required
            rows={4}
            placeholder="Describe the moves, crux, holds, and any beta that helped you…"
            className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-500 transition-colors resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">Sends</label>
          <input
            type="number"
            name="sends"
            min={0}
            placeholder="Times sent?"
            className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-500 transition-colors"
          />
        </div>

        <button
          type="submit"
          className="w-full bg-orange-500 hover:bg-orange-400 text-white font-semibold py-3 rounded-lg transition-colors mt-2"
        >
          Submit Climb
        </button>
      </form>
    </div>
  );
}
