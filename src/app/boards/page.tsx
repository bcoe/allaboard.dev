"use client";

import { useState, useEffect, useCallback } from "react";
import { Board } from "@/lib/types";
import { getBoards, createBoard, updateBoard } from "@/lib/db";
import { useAuth } from "@/lib/auth-context";

type FilterTab = "all" | "standard" | "spray_wall";

export default function BoardsPage() {
  const { user } = useAuth();
  const [boards, setBoards] = useState<Board[]>([]);
  const [tab, setTab] = useState<FilterTab>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<Board | null>(null);

  const reload = useCallback(() => {
    const type = tab === "all" ? undefined : tab;
    void getBoards(type).then(setBoards);
  }, [tab]);

  useEffect(reload, [reload]);

  return (
    <div className="max-w-2xl mx-auto">
      {showAdd && (
        <AddBoardModal
          onClose={() => setShowAdd(false)}
          onSuccess={() => { setShowAdd(false); reload(); }}
        />
      )}
      {editTarget && (
        <EditBoardModal
          board={editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={() => { setEditTarget(null); reload(); }}
        />
      )}

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-white">Boards</h1>
        {user && (
          <button
            onClick={() => setShowAdd(true)}
            className="bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            + Add Board
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-stone-800 mb-6">
        {(["all", "standard", "spray_wall"] as FilterTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t
                ? "border-orange-500 text-orange-400"
                : "border-transparent text-stone-500 hover:text-stone-300"
            }`}
          >
            {t === "spray_wall" ? "Spray Walls" : t === "standard" ? "Standard" : "All"}
          </button>
        ))}
      </div>

      {boards.length === 0 ? (
        <p className="text-stone-500 text-center py-12">No boards found.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {boards.map((board) => (
            <BoardCard
              key={board.id}
              board={board}
              canEdit={!!user && user.id === board.createdBy}
              onEdit={() => setEditTarget(board)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BoardCard({
  board,
  canEdit,
  onEdit,
}: {
  board: Board;
  canEdit: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="bg-stone-800 border border-stone-700 rounded-xl px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-semibold">{board.name}</span>
            <TypeBadge type={board.type} />
          </div>
          {board.location && (
            <p className="text-stone-400 text-sm mt-1">{board.location}</p>
          )}
          {board.description && (
            <p className="text-stone-500 text-sm mt-1 leading-relaxed">{board.description}</p>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-2">
          <div className="relative group cursor-default text-right">
            <p className="text-stone-500 text-xs font-medium uppercase tracking-wider">Multiplier</p>
            <p className="text-orange-400 font-bold text-xl tabular-nums leading-tight">
              x{board.relativeDifficulty.toFixed(2)}
            </p>
            <div className="absolute right-0 top-full mt-1.5 w-52 bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-xs text-stone-400 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
              Estimated relative difficulty to other boards. x1.00 is the baseline.
            </div>
          </div>
          {canEdit && (
            <button
              onClick={onEdit}
              className="text-xs text-stone-500 hover:text-orange-400 transition-colors"
            >
              Edit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TypeBadge({ type }: { type: Board["type"] }) {
  return type === "spray_wall" ? (
    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900 text-blue-300 font-medium">
      Spray Wall
    </span>
  ) : (
    <span className="text-xs px-2 py-0.5 rounded-full bg-stone-700 text-stone-300 font-medium">
      Standard
    </span>
  );
}

function AddBoardModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [type, setType] = useState<"standard" | "spray_wall">("spray_wall");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await createBoard({ name, type, location: location || undefined, description: description || undefined });
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create board");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Add Board" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Type selection */}
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-2">Board Type</label>
          <div className="flex gap-2">
            {(["spray_wall", "standard"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  type === t
                    ? "border-orange-500 bg-stone-700 text-white"
                    : "border-stone-700 bg-stone-900 text-stone-400 hover:border-stone-500"
                }`}
              >
                {t === "spray_wall" ? "Spray Wall" : "Standard Board"}
              </button>
            ))}
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">
            Board Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder={type === "spray_wall" ? "e.g. The Cave" : "e.g. Kilter Board (Original)"}
            className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2.5 text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-500 transition-colors"
          />
        </div>

        {type === "spray_wall" && (
          <>
            <div>
              <label className="block text-sm font-medium text-stone-300 mb-1.5">
                Location <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                required
                placeholder="e.g. Portland, OR"
                className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2.5 text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-300 mb-1.5">
                Description
                <span className="text-stone-500 font-normal ml-1">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Describe the wall — hold type, angle, size…"
                className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2.5 text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-500 transition-colors resize-none"
              />
            </div>
          </>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg border border-stone-700 text-stone-300 hover:text-white hover:border-stone-500 text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:bg-stone-700 disabled:text-stone-500 text-white text-sm font-semibold transition-colors"
          >
            {submitting ? "Adding…" : "Add Board"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditBoardModal({
  board,
  onClose,
  onSuccess,
}: {
  board: Board;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(board.name);
  const [location, setLocation] = useState(board.location ?? "");
  const [description, setDescription] = useState(board.description ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await updateBoard(board.id, { name, location: location || undefined, description: description || undefined });
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update board");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Edit Board" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">
            Board Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-orange-500 transition-colors"
          />
        </div>

        {board.type === "spray_wall" && (
          <>
            <div>
              <label className="block text-sm font-medium text-stone-300 mb-1.5">Location</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-orange-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-300 mb-1.5">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-orange-500 transition-colors resize-none"
              />
            </div>
          </>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg border border-stone-700 text-stone-300 hover:text-white hover:border-stone-500 text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:bg-stone-700 disabled:text-stone-500 text-white text-sm font-semibold transition-colors"
          >
            {submitting ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-stone-800 border border-stone-700 rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-white">{title}</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-white transition-colors text-lg">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
