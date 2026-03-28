"use client";

import { useState, useRef } from "react";
import { Grade } from "@/lib/types";
import { tickClimb } from "@/lib/db";
import { ALL_GRADES } from "@/lib/utils";
import StarRating from "@/components/StarRating";

interface TickModalProps {
  climbId: string;
  climbName: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function TickModal({ climbId, climbName, onClose, onSuccess }: TickModalProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate]                   = useState(today);
  const [sent, setSent]                   = useState(true);
  const [rating, setRating]               = useState(0);
  const [suggestedGrade, setSuggestedGrade] = useState<Grade | "">("");
  const [comment, setComment]             = useState("");
  const [instagramUrl, setInstagramUrl]   = useState("");
  const [submitting, setSubmitting]       = useState(false);
  const [error, setError]                 = useState("");
  const backdropRef = useRef<HTMLDivElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating === 0) { setError("Please select a star rating."); return; }
    setSubmitting(true);
    setError("");
    try {
      await tickClimb(climbId, {
        date,
        sent,
        suggestedGrade: suggestedGrade || undefined,
        rating,
        comment: comment.trim() || undefined,
        instagramUrl: instagramUrl.trim() || undefined,
      });
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
      <div className="bg-stone-900 border border-stone-700 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-stone-800">
          <div>
            <h2 className="text-white font-bold text-lg">Log a Tick</h2>
            <p className="text-stone-400 text-sm mt-0.5">{climbName}</p>
          </div>
          <button onClick={onClose} className="text-stone-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M6 18 18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-5">

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1.5">
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={today}
              className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>

          {/* Sent toggle */}
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1.5">
              Did you send it?
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSent(true)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${sent ? "bg-green-500/20 border-green-500 text-green-400" : "bg-stone-800 border-stone-700 text-stone-400 hover:border-stone-500"}`}
              >
                Yes — Sent!
              </button>
              <button
                type="button"
                onClick={() => setSent(false)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${!sent ? "bg-orange-500/20 border-orange-500 text-orange-400" : "bg-stone-800 border-stone-700 text-stone-400 hover:border-stone-500"}`}
              >
                No — Working
              </button>
            </div>
          </div>

          {/* Star rating */}
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-2">
              Rating <span className="text-red-400">*</span>
            </label>
            <StarRating value={rating} onChange={setRating} />
            {error && <p className="text-red-400 text-xs mt-1.5">{error}</p>}
          </div>

          {/* Suggested grade */}
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1.5">
              Suggested Grade
              <span className="text-stone-500 font-normal ml-1">(optional)</span>
            </label>
            <select
              value={suggestedGrade}
              onChange={(e) => setSuggestedGrade(e.target.value as Grade | "")}
              className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-orange-500 transition-colors"
            >
              <option value="">Agree with current grade</option>
              {ALL_GRADES.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>

          {/* Comment */}
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1.5">
              Comment
              <span className="text-stone-500 font-normal ml-1">(optional)</span>
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder="How did it go? Any beta tips?"
              className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-500 transition-colors resize-none"
            />
          </div>

          {/* Instagram URL */}
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1.5">
              Instagram Video
              <span className="text-stone-500 font-normal ml-1">(optional)</span>
            </label>
            <input
              type="url"
              value={instagramUrl}
              onChange={(e) => setInstagramUrl(e.target.value)}
              placeholder="https://www.instagram.com/reel/…"
              className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2.5 text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-orange-500 hover:bg-orange-400 disabled:bg-stone-700 disabled:text-stone-500 text-white font-semibold py-3 rounded-lg transition-colors"
          >
            {submitting ? "Saving…" : "Save Tick"}
          </button>
        </form>
      </div>
    </div>
  );
}
