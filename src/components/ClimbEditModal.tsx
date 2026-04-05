"use client";

import { useState, useEffect, useRef } from "react";
import { Climb, Board, Grade } from "@/lib/types";
import { updateClimb } from "@/lib/db";
import { ALL_GRADES } from "@/lib/utils";

interface ClimbEditModalProps {
  climb: Climb;
  onClose: () => void;
  onSuccess?: (updated: Climb) => void;
}

export default function ClimbEditModal({ climb, onClose, onSuccess }: ClimbEditModalProps) {
  const [boards, setBoards]           = useState<Board[]>([]);
  const [boardId, setBoardId]         = useState(climb.boardId ?? "");
  const [grade, setGrade]             = useState<Grade>(climb.grade as Grade);
  const [angle, setAngle]             = useState(climb.angle != null ? String(climb.angle) : "40");
  const [setter, setSetter]           = useState(climb.setter ?? "");
  const [description, setDescription] = useState(climb.description ?? "");
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState("");
  const backdropRef = useRef<HTMLDivElement>(null);

  const selectedBoard = boards.find((b) => b.id === boardId);

  useEffect(() => {
    fetch("/api/boards")
      .then((r) => r.json())
      .then((loaded: Board[]) => {
        setBoards(loaded);
        // Default to the climb's current board if boardId not yet set
        if (!boardId && climb.boardId) setBoardId(climb.boardId);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const isSprayWall = selectedBoard?.type === "spray_wall";
      const updated = await updateClimb(climb.id, {
        grade,
        boardId,
        angle: isSprayWall ? undefined : (angle ? Number(angle) : 40),
        setter: setter.trim() || undefined,
        description: description.trim() || undefined,
      });
      onClose();
      onSuccess?.(updated);
    } catch {
      setError("Failed to save changes. Please try again.");
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
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-stone-800 shrink-0">
          <div>
            <h2 className="text-white font-bold text-lg">Edit Climb</h2>
            <p className="text-stone-400 text-sm mt-0.5">{climb.name}</p>
          </div>
          <button onClick={onClose} className="text-stone-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-4 flex flex-col gap-4 overflow-y-auto">

          {/* Grade + Angle */}
          <div className={selectedBoard?.type === "spray_wall" ? "" : "grid grid-cols-2 gap-4"}>
            <div>
              <label className="block text-xs font-medium text-stone-400 mb-1">
                Grade <span className="text-red-400">*</span>
              </label>
              <select
                value={grade}
                onChange={(e) => setGrade(e.target.value as Grade)}
                required
                className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 transition-colors"
              >
                {ALL_GRADES.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
            {selectedBoard?.type !== "spray_wall" && (
              <div>
                <label className="block text-xs font-medium text-stone-400 mb-1">
                  Angle (degrees)
                </label>
                <input
                  type="number"
                  min={0}
                  max={90}
                  value={angle}
                  onChange={(e) => setAngle(e.target.value)}
                  className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 transition-colors"
                />
              </div>
            )}
          </div>

          {/* Board */}
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">
              Board <span className="text-red-400">*</span>
            </label>
            <div className="flex flex-col gap-2">
              {boards.map((board) => (
                <label
                  key={board.id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
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
                    className="accent-orange-500"
                  />
                  <span className="text-white text-sm">{board.name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Setter */}
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1">
              Setter <span className="text-stone-600 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={setter}
              onChange={(e) => setSetter(e.target.value)}
              placeholder="e.g. Chris Sharma"
              className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-white text-sm placeholder:text-stone-600 focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1">
              Description / Beta <span className="text-stone-600 font-normal">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Describe the moves, crux, holds…"
              className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-white text-sm placeholder:text-stone-600 focus:outline-none focus:border-orange-500 transition-colors resize-none"
            />
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-orange-500 hover:bg-orange-400 disabled:bg-stone-700 disabled:text-stone-500 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
          >
            {submitting ? "Saving…" : "Save Changes"}
          </button>
        </form>
      </div>
    </div>
  );
}
