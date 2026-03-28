"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Climb } from "@/lib/types";
import { getClimbById } from "@/lib/db";
import GradeBadge from "@/components/GradeBadge";

export default function ClimbPage() {
  const { id } = useParams<{ id: string }>();
  const [climb, setClimb] = useState<Climb | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    void (async () => {
      const c = await getClimbById(id);
      if (c) setClimb(c);
      else setNotFound(true);
    })();
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
    <div className="max-w-2xl mx-auto pb-12">
      <Link href="/climbs" className="text-stone-400 hover:text-white text-sm transition-colors mb-6 inline-flex items-center gap-1">
        ← Back to climbs
      </Link>

      <div className="mt-4">
        {/* Grade + metadata */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <GradeBadge grade={climb.grade} size="md" />
          <span className="text-stone-300 text-sm bg-stone-800 px-2.5 py-1 rounded font-medium">
            {climb.boardType}
          </span>
          {climb.angle !== undefined && (
            <span className="text-stone-400 text-sm bg-stone-800/60 px-2.5 py-1 rounded">
              {climb.angle}°
            </span>
          )}
          {climb.sends !== undefined && (
            <span className="ml-auto text-green-400 text-sm font-semibold">
              {climb.sends} {climb.sends === 1 ? "send" : "sends"}
            </span>
          )}
        </div>

        <h1 className="text-3xl font-bold text-white">{climb.name}</h1>
        <div className="flex items-center gap-3 mt-2 text-sm text-stone-400">
          <span>@{climb.author}</span>
          <span>·</span>
          <span>{new Date(climb.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
        </div>

        <p className="mt-5 text-stone-300 leading-relaxed">{climb.description}</p>

        {/* Beta videos */}
        {climb.betaVideos && climb.betaVideos.length > 0 && (
          <div className="mt-6">
            <h2 className="text-white font-semibold mb-3">
              Beta ({climb.betaVideos.length} {climb.betaVideos.length === 1 ? "video" : "videos"})
            </h2>
            <div className="grid grid-cols-3 gap-2">
              {climb.betaVideos.map((video, i) => (
                <a
                  key={i}
                  href={video.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative aspect-square rounded-xl overflow-hidden bg-stone-700 block ring-1 ring-stone-600 hover:ring-orange-500 transition-all"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Image
                    src={video.thumbnail}
                    alt={`Beta by ${video.credit ?? "unknown"}`}
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 33vw, 200px"
                  />
                  <div className="absolute inset-0 bg-black/25 flex items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
                      <svg className="w-5 h-5 text-white translate-x-0.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>
                  <div className="absolute top-2 right-2">
                    {video.platform === "instagram" && (
                      <svg className="w-4 h-4 text-white drop-shadow" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                      </svg>
                    )}
                  </div>
                  {video.credit && (
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5">
                      <p className="text-white text-xs font-medium truncate">{video.credit}</p>
                    </div>
                  )}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
