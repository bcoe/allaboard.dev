"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Comment } from "@/lib/types";
import { getTickComments, postComment, deleteComment } from "@/lib/db";
import { useAuth } from "@/lib/auth-context";
import { timeAgo } from "@/lib/utils";
import UserAvatar from "./UserAvatar";

interface Props {
  tickId: string;
  highlightCommentId?: string;
}

function addToTree(tree: Comment[], parentId: string, node: Comment): Comment[] {
  return tree.map((c) =>
    c.id === parentId
      ? { ...c, replies: [...c.replies, node] }
      : { ...c, replies: addToTree(c.replies, parentId, node) },
  );
}

function removeFromTree(tree: Comment[], id: string): Comment[] {
  return tree
    .filter((c) => c.id !== id)
    .map((c) => ({ ...c, replies: removeFromTree(c.replies, id) }));
}

export default function CommentSection({ tickId, highlightCommentId }: Props) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBody, setNewBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setComments(await getTickComments(tickId));
    } finally {
      setLoading(false);
    }
  }, [tickId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!highlightCommentId || loading) return;
    document.getElementById(`comment-${highlightCommentId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightCommentId, loading]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newBody.trim() || submitting) return;
    setSubmitting(true);
    try {
      const comment = await postComment({ tickId, body: newBody.trim() });
      setComments((prev) => [...prev, comment]);
      setNewBody("");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="px-4 py-2 text-stone-500 text-xs">Loading comments…</div>;
  }

  return (
    <div className="border-t border-stone-700 mt-3 pt-3 flex flex-col gap-3">
      {comments.length === 0 && !user && (
        <p className="text-stone-500 text-xs px-1">No comments yet.</p>
      )}

      {comments.map((c) => (
        <CommentNode
          key={c.id}
          comment={c}
          tickId={tickId}
          currentUserId={user?.id}
          highlightCommentId={highlightCommentId}
          depth={0}
          onReply={(parentId, reply) =>
            setComments((prev) => addToTree(prev, parentId, reply))
          }
          onDelete={(id) =>
            setComments((prev) => removeFromTree(prev, id))
          }
        />
      ))}

      {user && (
        <form onSubmit={handleSubmit} className="flex gap-2 mt-1">
          <input
            type="text"
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder="Add a comment…"
            className="flex-1 bg-stone-900 border border-stone-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-stone-500 focus:outline-none focus:border-stone-500"
          />
          <button
            type="submit"
            disabled={!newBody.trim() || submitting}
            className="px-3 py-1.5 text-sm bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-white rounded-lg transition-colors"
          >
            Post
          </button>
        </form>
      )}
    </div>
  );
}

function CommentNode({
  comment,
  tickId,
  currentUserId,
  highlightCommentId,
  depth,
  onReply,
  onDelete,
}: {
  comment: Comment;
  tickId: string;
  currentUserId?: string;
  highlightCommentId?: string;
  depth: number;
  onReply: (parentId: string, reply: Comment) => void;
  onDelete: (id: string) => void;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isHighlighted = highlightCommentId === comment.id;

  useEffect(() => {
    if (!isHighlighted) return;
    document.getElementById(`comment-${comment.id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [isHighlighted, comment.id]);

  const avatarUser = {
    id: comment.userId, handle: comment.userHandle,
    displayName: comment.userDisplayName, avatarColor: comment.userAvatarColor,
    profilePictureUrl: comment.userProfilePictureUrl,
    bio: "", homeBoard: "", homeBoardAngle: 0, joinedAt: "",
    followersCount: 0, followingCount: 0, personalBests: {},
  };

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyBody.trim() || submitting) return;
    setSubmitting(true);
    try {
      const reply = await postComment({
        tickId,
        body: replyBody.trim(),
        parentCommentId: comment.id,
      });
      onReply(comment.id, reply);
      setReplyBody("");
      setReplyOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    await deleteComment(comment.id);
    onDelete(comment.id);
  }

  return (
    <div
      id={`comment-${comment.id}`}
      className={`rounded-lg transition-colors ${
        isHighlighted ? "bg-orange-500/10 border border-orange-500/30 p-2" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <Link href={`/user/${comment.userHandle}`} className="shrink-0 mt-0.5">
          <UserAvatar user={avatarUser} size="sm" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <Link
              href={`/user/${comment.userHandle}`}
              className="text-white text-xs font-semibold hover:text-orange-400 transition-colors"
            >
              @{comment.userHandle}
            </Link>
            <span className="text-stone-600 text-xs">{timeAgo(comment.createdAt)}</span>
          </div>

          <p className="text-stone-300 text-sm mt-0.5 break-words">{comment.body}</p>

          <div className="flex items-center gap-3 mt-1">
            {currentUserId && (
              <button
                onClick={() => setReplyOpen((o) => !o)}
                className="text-stone-500 hover:text-stone-300 text-xs transition-colors"
              >
                Reply
              </button>
            )}
            {currentUserId === comment.userId && (
              <button
                onClick={handleDelete}
                className="text-stone-500 hover:text-red-400 text-xs transition-colors"
              >
                Delete
              </button>
            )}
          </div>

          {replyOpen && (
            <form onSubmit={handleReply} className="flex gap-2 mt-2">
              <input
                type="text"
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder={`Reply to @${comment.userHandle}…`}
                autoFocus
                className="flex-1 bg-stone-800 border border-stone-700 rounded-lg px-3 py-1 text-sm text-white placeholder-stone-500 focus:outline-none focus:border-stone-500"
              />
              <button
                type="submit"
                disabled={!replyBody.trim() || submitting}
                className="px-2.5 py-1 text-xs bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-white rounded-lg transition-colors"
              >
                Reply
              </button>
            </form>
          )}
        </div>
      </div>

      {comment.replies.length > 0 && (
        <div className={`mt-2 flex flex-col gap-2 pl-4 ${depth < 3 ? "border-l border-stone-700/60" : ""}`}>
          {comment.replies.map((reply) => (
            <CommentNode
              key={reply.id}
              comment={reply}
              tickId={tickId}
              currentUserId={currentUserId}
              highlightCommentId={highlightCommentId}
              depth={depth + 1}
              onReply={onReply}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
