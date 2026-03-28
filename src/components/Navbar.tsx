"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { mockUsers } from "@/lib/mock-data";
import UserAvatar from "./UserAvatar";

const ME = mockUsers[0]; // alex_sends

const NAV_ITEMS = [
  { label: "Following", href: "/" },
  { label: "Climbs",    href: "/climbs" },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="bg-stone-900 border-b border-stone-700 sticky top-0 z-40">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="text-white font-bold text-xl tracking-tight">
          allaboard
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

        <Link href="/profile" aria-label="Profile">
          <UserAvatar user={ME} size="sm" />
        </Link>
      </div>
    </nav>
  );
}
