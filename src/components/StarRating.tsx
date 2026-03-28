"use client";

interface StarRatingProps {
  value: number;        // current value (0–4)
  onChange?: (v: number) => void; // if provided, stars are interactive
  size?: "sm" | "md";
}

export default function StarRating({ value, onChange, size = "md" }: StarRatingProps) {
  const dim = size === "sm" ? "w-4 h-4" : "w-6 h-6";

  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4].map((star) => {
        const filled = star <= value;
        return (
          <button
            key={star}
            type="button"
            onClick={() => onChange?.(star)}
            disabled={!onChange}
            className={`${dim} transition-colors ${onChange ? "cursor-pointer" : "cursor-default"}`}
            aria-label={`${star} star${star !== 1 ? "s" : ""}`}
          >
            <svg
              viewBox="0 0 24 24"
              fill={filled ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth={1.5}
              className={filled ? "text-amber-400" : "text-stone-600"}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
