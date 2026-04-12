"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useRef, useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import UserAvatar from "./UserAvatar";

const NAV_ITEMS = [
  { label: "Feed",   href: "/" },
  { label: "Climbs", href: "/climbs" },
  { label: "Boards", href: "/boards" },
  { label: "Game",   href: "/game" },
];

export default function Navbar() {
  const pathname = usePathname();
  const { user, loading, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <nav className="bg-stone-900 border-b border-stone-700 sticky top-0 z-40">
      <div className="max-w-5xl mx-auto px-4 py-2 flex items-center justify-between">
        <Link href="/" className="flex items-center">
          <Image src="/logo.png" alt="Allaboard" width={78} height={78} priority />
        </Link>

        <div className="flex items-center gap-1">
          {NAV_ITEMS.map(({ label, href }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  active
                    ? "bg-stone-800 text-white"
                    : "text-stone-400 hover:text-white hover:bg-stone-800"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>

        {/* Right side: skeleton while loading, login link or avatar dropdown */}
        {loading ? (
          <div className="w-7 h-7 rounded-full bg-stone-700 animate-pulse" />
        ) : user ? (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((o) => !o)}
              aria-label="Account menu"
              className="rounded-full focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-stone-900"
            >
              <UserAvatar user={user} size="xl" />
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-stone-800 border border-stone-700 rounded-xl shadow-xl py-1 z-50">
                <div className="px-4 py-2.5 border-b border-stone-700">
                  <div className="text-white text-sm font-semibold truncate">@{user.handle}</div>
                </div>
                <Link
                  href={`/user/${user.handle}`}
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-stone-300 hover:text-white hover:bg-stone-700 transition-colors"
                >
                  View Profile
                </Link>
                <button
                  onClick={() => { logout(); setDropdownOpen(false); }}
                  className="w-full text-left flex items-center gap-2 px-4 py-2 text-sm text-stone-300 hover:text-white hover:bg-stone-700 transition-colors"
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        ) : (
          <a
            href="/api/auth/google"
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-orange-500 hover:bg-orange-400 text-white transition-colors"
          >
            Login
          </a>
        )}
      </div>
    </nav>
  );
}
