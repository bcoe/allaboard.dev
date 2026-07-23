"use client";

import { useState, useRef } from "react";
import { Grade } from "@/lib/types";
import { tickClimb, updateTick } from "@/lib/db";
import { ALL_GRADES } from "@/lib/utils";
import StarRating from "@/components/StarRating";

interface TickModalInitialData {
  date?: string;
  sent?: boolean;
  attempts?: number;
  durationMinutes?: number;
  rating?: number;
  suggestedGrade?: Grade;
  comment?: string;
  instagramUrl?: string;
}

interface TickModalProps {
  climbId: string;
  climbName: string;
  onClose: () => void;
  onSuccess?: () => void;
  initialData?: TickModalInitialData;
  /** If provided, edits this existing tick instead of creating a new one. */
  tickId?: string;
}

export default function TickModal({ climbId, climbName, onClose, onSuccess, initialData, tickId }: TickModalProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate]                   = useState(initialData?.date ? initialData.date.slice(0, 10) : today);
  const [sent, setSent]                   = useState(initialData?.sent ?? true);
  const [attempts, setAttempts]           = useState(initialData?.attempts != null ? String(initialData.attempts) : "");
  const [durationMinutes, setDurationMinutes] = useState(initialData?.durationMinutes != null ? String(initialData.durationMinutes) : "");
  const [rating, setRating]               = useState(initialData?.rating ?? 0);
  const [suggestedGrade, setSuggestedGrade] = useState<Grade | "">(initialData?.suggestedGrade ?? "");
  const [comment, setComment]             = useState(initialData?.comment ?? "");
  const [instagramUrl, setInstagramUrl]   = useState(initialData?.instagramUrl ?? "");
  const [submitting, setSubmitting]       = useState(false);
  const [error, setError]                 = useState("");
  const backdropRef = useRef<HTMLDivElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating === 0) { setError("Please select a star rating."); return; }
    setSubmitting(true);
    setError("");
    const payload = {
      date,
      sent,
      attempts: attempts ? Number(attempts) : undefined,
      durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
      suggestedGrade: suggestedGrade || undefined,
      rating,
      comment: comment.trim() || undefined,
      instagramUrl: instagramUrl.trim() || undefined,
    };
    try {
      if (tickId) {
        await updateTick(tickId, payload);
      } else {
        await tickClimb(climbId, payload);
      }
      onClose();
      onSuccess?.();
    } catch {
      setError("Failed to save tick. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onMouseDown={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div className="bg-stone-900 border border-stone-700 rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-stone-800 shrink-0">
          <div>
            <h2 className="text-white font-bold text-lg">{tickId ? "Edit Tick" : "Log a Tick"}</h2>
            <p className="text-stone-400 text-sm mt-0.5">{climbName}</p>
          </div>
          <button onClick={onClose} className="text-stone-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M6 18 18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 flex flex-col gap-3 overflow-y-auto">

          {/* Date + Sent toggle side by side */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-stone-400 mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                max={today}
                className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 transition-colors"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-stone-400 mb-1">Result</label>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setSent(true)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors border ${sent ? "bg-green-500/20 border-green-500 text-green-400" : "bg-stone-800 border-stone-700 text-stone-400 hover:border-stone-500"}`}
                >
                  Sent
                </button>
                <button
                  type="button"
                  onClick={() => setSent(false)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors border ${!sent ? "bg-orange-500/20 border-orange-500 text-orange-400" : "bg-stone-800 border-stone-700 text-stone-400 hover:border-stone-500"}`}
                >
                  Working
                </button>
              </div>
            </div>
          </div>

          {/* Attempts + Suggested grade side by side */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-stone-400 mb-1">
                Attempts <span className="text-stone-600 font-normal">(optional)</span>
              </label>
              <input
                type="number"
                min={1}
                value={attempts}
                onChange={(e) => setAttempts(e.target.value)}
                placeholder="leave blank = a bunch"
                className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-white text-sm placeholder:text-stone-600 focus:outline-none focus:border-orange-500 transition-colors"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-stone-400 mb-1">
                Suggested Grade <span className="text-stone-600 font-normal">(optional)</span>
              </label>
              <select
                value={suggestedGrade}
                onChange={(e) => setSuggestedGrade(e.target.value as Grade | "")}
                className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 transition-colors"
              >
                <option value="">Agree with grade</option>
                {ALL_GRADES.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Time spent working the climb */}
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1">
              Time spent <span className="text-stone-600 font-normal">(minutes, optional)</span>
            </label>
            <input
              type="number"
              min={1}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              placeholder="e.g. 30"
              className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-white text-sm placeholder:text-stone-600 focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>

          {/* Star rating */}
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">
              Rating <span className="text-red-400">*</span>
            </label>
            <StarRating value={rating} onChange={setRating} />
            {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
          </div>

          {/* Comment */}
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1">
              Comment <span className="text-stone-600 font-normal">(optional)</span>
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="How did it go? Any beta tips?"
              className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-white text-sm placeholder:text-stone-600 focus:outline-none focus:border-orange-500 transition-colors resize-none"
            />
          </div>

          {/* Instagram URL */}
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1">
              Instagram Video <span className="text-stone-600 font-normal">(optional)</span>
            </label>
            <input
              type="url"
              value={instagramUrl}
              onChange={(e) => setInstagramUrl(e.target.value)}
              placeholder="https://www.instagram.com/reel/…"
              className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-white text-sm placeholder:text-stone-600 focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-orange-500 hover:bg-orange-400 disabled:bg-stone-700 disabled:text-stone-500 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
          >
            {submitting ? "Saving…" : tickId ? "Save Changes" : "Save Tick"}
          </button>
        </form>
      </div>
    </div>
  );
}
