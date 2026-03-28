"use client";

import { useState, useEffect } from "react";
import { getClimbs, logClimb } from "@/lib/db";
import { Climb } from "@/lib/types";

interface Props {
  userId: string;
  onClose: () => void;
  onLogged?: () => void;
}

export default function LogClimbModal({ userId, onClose, onLogged }: Props) {
  const [climbs, setClimbs] = useState<Climb[]>([]);
  const [sent, setSent] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    void (async () => {
      const { climbs } = await getClimbs();
      setClimbs(climbs);
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await logClimb({
      climbId:  fd.get("climbId") as string,
      date:     fd.get("date") as string,
      attempts: Number(fd.get("attempts")),
      sent,
      notes:    (fd.get("notes") as string) || undefined,
      userId,
    });
    setSubmitted(true);
    onLogged?.();
    setTimeout(onClose, 1000);
  }

  if (submitted) {
    return (
      <Backdrop onClose={onClose}>
        <div className="text-center py-10 px-6">
          <div className="text-4xl mb-3">🎉</div>
          <p className="text-white font-semibold text-lg">Logged!</p>
          <p className="text-stone-400 text-sm mt-1">Nice work out there.</p>
        </div>
      </Backdrop>
    );
  }

  return (
    <Backdrop onClose={onClose}>
      <div className="p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-bold text-lg">Log a Climb</h2>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-white transition-colors text-lg leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1.5">
              Climb <span className="text-red-400">*</span>
            </label>
            <select
              name="climbId"
              required
              className="w-full bg-stone-700 border border-stone-600 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-orange-500 transition-colors"
            >
              <option value="">Select a climb…</option>
              {climbs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.grade}) · {c.boardName}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-stone-300 mb-1.5">
                Date
              </label>
              <input
                type="date"
                name="date"
                defaultValue={new Date().toISOString().split("T")[0]}
                className="w-full bg-stone-700 border border-stone-600 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-orange-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-300 mb-1.5">
                Attempts <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                name="attempts"
                min={1}
                required
                placeholder="e.g. 5"
                className="w-full bg-stone-700 border border-stone-600 rounded-lg px-3 py-2.5 text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-500 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-300 mb-2">
              Did you send it?
            </label>
            <button
              type="button"
              onClick={() => setSent((s) => !s)}
              className={`w-full py-2.5 rounded-lg font-medium text-sm transition-colors ${
                sent
                  ? "bg-green-600 hover:bg-green-500 text-white"
                  : "bg-stone-700 hover:bg-stone-600 text-stone-300"
              }`}
            >
              {sent ? "✓ Sent!" : "Not yet"}
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1.5">
              Notes
            </label>
            <textarea
              name="notes"
              rows={3}
              placeholder="Beta, conditions, what clicked…"
              className="w-full bg-stone-700 border border-stone-600 rounded-lg px-3 py-2.5 text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-500 transition-colors resize-none text-sm"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-orange-500 hover:bg-orange-400 text-white font-semibold py-2.5 rounded-lg transition-colors"
          >
            Log Climb
          </button>
        </form>
      </div>
    </Backdrop>
  );
}

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-stone-900 border border-stone-700 rounded-2xl w-full max-w-md shadow-2xl">
        {children}
      </div>
    </div>
  );
}
