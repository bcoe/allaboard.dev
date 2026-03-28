import Link from "next/link";
import Image from "next/image";
import { Climb } from "@/lib/types";
import GradeBadge from "./GradeBadge";
import StarRating from "./StarRating";

// Instagram icon SVG path
const INSTAGRAM_PATH =
  "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z";

interface ClimbCardProps {
  climb: Climb;
  canTick?: boolean;
  onTick?: () => void;
}

export default function ClimbCard({ climb, canTick, onTick }: ClimbCardProps) {
  return (
    <div className="relative">
      <Link href={`/climbs/${climb.id}`}>
        <div className="bg-stone-800 border border-stone-700 rounded-xl p-4 hover:border-stone-500 transition-colors cursor-pointer">

          {/* Top row: grade + metadata pills + sends */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <GradeBadge grade={climb.grade} />
              {climb.boardName && (
                <span className="text-stone-300 text-xs bg-stone-700 px-2 py-0.5 rounded font-medium">
                  {climb.boardName}
                </span>
              )}
              <span className="text-stone-400 text-xs bg-stone-700/60 px-2 py-0.5 rounded">
                {climb.angle}°
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {climb.starRating != null && (
                <StarRating value={Math.round(climb.starRating)} size="sm" />
              )}
              <span className="text-green-400 text-xs font-semibold">
                {climb.sends} {climb.sends === 1 ? "send" : "sends"}
              </span>
            </div>
          </div>

          {/* Climb name */}
          <h2 className="text-white font-semibold mt-2.5 text-base leading-snug">
            {climb.name}
          </h2>

          {/* Description */}
          {climb.description && (
            <p className="text-stone-400 text-sm mt-1.5 line-clamp-2 leading-relaxed">
              {climb.description}
            </p>
          )}

          {/* Beta video thumbnails */}
          {climb.betaVideos && climb.betaVideos.length > 0 && (
            <div className="flex gap-2 mt-3">
              {climb.betaVideos.map((video, i) => (
                <div
                  key={i}
                  className="relative w-16 h-16 rounded-lg overflow-hidden bg-stone-700 shrink-0 ring-1 ring-stone-600"
                >
                  {video.thumbnail ? (
                    <Image
                      src={video.thumbnail}
                      alt="Instagram beta"
                      fill
                      className="object-cover"
                      sizes="64px"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400 flex items-center justify-center">
                      <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d={INSTAGRAM_PATH} />
                      </svg>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                    <div className="w-5 h-5 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white translate-x-px" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-4 text-xs text-stone-500">
              <span>
                <span className="text-stone-600">submitted by </span>
                <span className="text-stone-400">@{climb.author}</span>
              </span>
              {climb.setter && (
                <span>
                  <span className="text-stone-600">setter </span>
                  <span className="text-stone-400">{climb.setter}</span>
                </span>
              )}
            </div>
            {canTick && onTick && (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTick(); }}
                className="text-xs text-orange-400 hover:text-orange-300 font-medium transition-colors shrink-0"
              >
                + Tick
              </button>
            )}
          </div>

        </div>
      </Link>
    </div>
  );
}
