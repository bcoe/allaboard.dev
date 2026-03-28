import { User } from "@/lib/types";

export default function UserAvatar({
  user,
  size = "md",
}: {
  user: User;
  size?: "sm" | "md" | "lg";
}) {
  const dims = size === "lg" ? "w-16 h-16 text-xl" : size === "sm" ? "w-7 h-7 text-xs" : "w-9 h-9 text-sm";
  const initials = user.displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      className={`${dims} ${user.avatarColor} rounded-full flex items-center justify-center font-bold text-white shrink-0`}
    >
      {initials}
    </div>
  );
}
