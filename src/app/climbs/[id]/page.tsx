"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ClimbTick, Climb } from "@/lib/types";
import { getClimbById, getClimbTicks } from "@/lib/db";
import { useAuth } from "@/lib/auth-context";
import { timeAgo } from "@/lib/utils";
import GradeBadge from "@/components/GradeBadge";
import StarRating from "@/components/StarRating";
import TickModal from "@/components/TickModal";
import UserAvatar from "@/components/UserAvatar";

export default function ClimbPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [climb, setClimb]         = useState<Climb | null>(null);
  const [ticks, setTicks]         = useState<ClimbTick[]>([]);
  const [notFound, setNotFound]   = useState(false);
  const [tickModal, setTickModal] = useState(false);

  const isOwner = !!(user && climb && user.id === climb.author);

  async function loadClimb() {
    const c = await getClimbById(id);
    if (c) setClimb(c);
    else setNotFound(true);
  }

  async function loadTicks() {
    setTicks(await getClimbTicks(id));
  }

  useEffect(() => {
    void loadClimb();
    void loadTicks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (notFound) {
    return (
      <div className="text-center py-16 text-stone-500">
        Climb not found.{" "}
        <Link href="/climbs" className="text-orange-400 hover:underline">Back to climbs</Link>
      </div>
    );
  }

  if (!climb) {
    return <div className="text-stone-500 text-center py-16">Loading…</div>;
  }

  return (
    <>
      {tickModal && (
        <TickModal
          climbId={id}
          climbName={climb.name}
          onClose={() => setTickModal(false)}
          onSuccess={() => { void loadClimb(); void loadTicks(); }}
        />
      )}

      <div className="max-w-2xl mx-auto pb-12">
        <div className="flex items-center justify-between mb-6">
          <Link href="/climbs" className="text-stone-400 hover:text-white text-sm transition-colors inline-flex items-center gap-1">
            ← Back to climbs
          </Link>
          <div className="flex items-center gap-2">
            {user && (
              <button
                onClick={() => setTickModal(true)}
                className="text-sm text-white bg-orange-500 hover:bg-orange-400 px-3 py-1.5 rounded-lg transition-colors font-medium"
              >
                Tick this climb
              </button>
            )}
            {isOwner && (
              <Link
                href={`/climbs/${id}/edit`}
                className="text-sm text-stone-400 hover:text-white border border-stone-700 hover:border-stone-500 px-3 py-1.5 rounded-lg transition-colors"
              >
                Edit climb
              </Link>
            )}
          </div>
        </div>

        <div className="mt-2">
          <h1 className="text-3xl font-bold text-orange-400 mb-3">{climb.name}</h1>

          {/* Grade + metadata */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <GradeBadge grade={climb.grade} size="md" />
            {climb.boardName && (
              <span className="text-stone-300 text-sm bg-stone-800 px-2.5 py-1 rounded font-medium">
                {climb.boardName}
              </span>
            )}
            <span className="text-stone-400 text-sm bg-stone-800/60 px-2.5 py-1 rounded">
              {climb.angle}°
            </span>
            <div className="ml-auto flex items-center gap-3">
              {climb.starRating != null && (
                <div className="flex items-center gap-1.5">
                  <StarRating value={Math.round(climb.starRating)} size="sm" />
                  <span className="text-stone-400 text-xs">{climb.starRating.toFixed(1)}</span>
                </div>
              )}
              <span className="text-green-400 text-sm font-semibold">
                {climb.sends} {climb.sends === 1 ? "send" : "sends"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-2 text-sm text-stone-400">
            <span>submitted by @{climb.author}</span>
            {climb.setter && (
              <>
                <span>·</span>
                <span>setter: {climb.setter}</span>
              </>
            )}
            <span>·</span>
            <span>{new Date(climb.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
          </div>

          {climb.description && (
            <p className="mt-5 text-stone-300 leading-relaxed">{climb.description}</p>
          )}

          {/* Beta videos */}
          {climb.betaVideos && climb.betaVideos.length > 0 && (
            <div className="mt-8">
              <h2 className="text-orange-400 font-semibold mb-3">
                Beta ({climb.betaVideos.length} {climb.betaVideos.length === 1 ? "video" : "videos"})
              </h2>
              <div className="flex flex-wrap gap-4">
                {climb.betaVideos.map((video, i) => (
                  <a
                    key={i}
                    href={video.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col items-center gap-2 group"
                  >
                    <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400 flex items-center justify-center ring-1 ring-stone-600 group-hover:ring-orange-400 transition-all">
                      <svg className="w-9 h-9 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d={INSTAGRAM_ICON_PATH} />
                      </svg>
                    </div>
                    <span className="text-stone-400 text-xs group-hover:text-white transition-colors">
                      @{video.submittedBy}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Tick list */}
          <div className="mt-10">
            <h2 className="text-orange-400 font-semibold text-lg mb-4">
              Ticks ({ticks.length})
            </h2>
            {ticks.length === 0 ? (
              <p className="text-stone-500 text-sm">No ticks yet — be the first!</p>
            ) : (
              <div className="flex flex-col gap-4">
                {ticks.map((tick) => (
                  <ClimbTickCard key={tick.id} tick={tick} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

const INSTAGRAM_ICON_PATH =
  "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z";

function ClimbTickCard({ tick }: { tick: ClimbTick }) {
  const avatarUser = {
    id: tick.userHandle,
    handle: tick.userHandle,
    displayName: tick.userDisplayName,
    avatarColor: tick.userAvatarColor,
    profilePictureUrl: tick.userProfilePictureUrl,
    bio: "",
    homeBoard: "",
    homeBoardAngle: 0,
    joinedAt: "",
    followersCount: 0,
    followingCount: 0,
    personalBests: {},
  };

  return (
    <div className="bg-stone-800 border border-stone-700 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <UserAvatar user={avatarUser} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/user/${tick.userHandle}`}
              className="text-white font-semibold text-sm hover:text-orange-400 transition-colors"
            >
              @{tick.userHandle}
            </Link>
            <span className="text-stone-600 text-xs">·</span>
            <span className="text-stone-500 text-xs">{timeAgo(tick.date)}</span>
          </div>

          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {tick.sent ? (
              <span className="text-green-400 text-sm font-medium">Sent</span>
            ) : (
              <span className="text-stone-400 text-sm">Working</span>
            )}
            {tick.suggestedGrade && (
              <>
                <span className="text-stone-600 text-xs">·</span>
                <span className="text-stone-400 text-xs">suggests</span>
                <GradeBadge grade={tick.suggestedGrade} />
              </>
            )}
          </div>

          <div className="mt-1.5 flex items-center gap-3 flex-wrap">
            <StarRating value={Math.round(tick.rating)} size="sm" />
            <span className="text-xs text-stone-500">
              {tick.attempts != null
                ? `${tick.attempts} ${tick.attempts === 1 ? "attempt" : "attempts"}`
                : "a bunch of attempts"}
            </span>
          </div>

          {tick.comment && (
            <p className="mt-2 text-stone-300 text-sm leading-relaxed">{tick.comment}</p>
          )}

          {tick.instagramUrl && (
            <a
              href={tick.instagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-stone-400 hover:text-white transition-colors group"
            >
              <div className="w-5 h-5 rounded bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400 flex items-center justify-center shrink-0">
                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d={INSTAGRAM_ICON_PATH} />
                </svg>
              </div>
              Watch video
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
