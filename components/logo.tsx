import { cn } from "@/lib/utils";

/**
 * The Clawback mark: a ring that loops back on itself, ending in an arrowhead.
 *
 * That is the product in one glyph — money that went out to a landlord and is
 * being reclaimed — and it is built from two primitives so it survives the size
 * it actually lives at: 14px, inside the tile in the app chrome.
 *
 * The head is **solid, not stroked**. A stroked chevron and a stroked triangle
 * were both drawn and both turned to mush at 14px, because a 2.7px stroke has no
 * room left to describe an arrowhead; a filled triangle keeps its silhouette at
 * any size. That is the whole reason this file hand-draws an SVG instead of
 * borrowing a lucide icon.
 *
 * The geometry is a circle of radius 8.2 with a 60° bite out of its upper right.
 * `stroke-dasharray` is the full circumference split in two — 51.52 = 42.93 dash
 * + 8.59 gap. **If you change the radius, recompute both** (2πr, and 60/360 of
 * it) or the ring stops meeting itself and the gap drifts around the circle. The
 * head's three points are placed from the arc's end tangent for the same reason:
 * move the gap and they must move with it.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="8.2"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.7}
        strokeLinecap="round"
        strokeDasharray="42.93 8.59"
      />
      <path d="M19.22 6.7 17.2 2.19 14.3 7.21Z" fill="currentColor" />
    </svg>
  );
}

/**
 * The mark in its tile, with the wordmark.
 *
 * `inverted` exists for the surfaces that sit on black rather than on the app's
 * warm paper. The landing page no longer uses it — it shows the bare wordmark at
 * the top and no mark at all — so this is now for the dark contexts only.
 */
export function Logo({
  size = "md",
  inverted = false,
  className,
}: {
  size?: "sm" | "md";
  inverted?: boolean;
  className?: string;
}) {
  const tile = size === "sm" ? "size-6 rounded-[6px]" : "size-7 rounded-lg";
  const glyph = size === "sm" ? "size-3.5" : "size-4";
  const word = size === "sm" ? "text-[13px]" : "text-[15px]";

  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "flex shrink-0 items-center justify-center bg-primary text-primary-foreground",
          tile
        )}
      >
        <LogoMark className={glyph} />
      </span>
      <span
        className={cn(
          "font-semibold tracking-[-0.02em]",
          word,
          inverted ? "text-white" : "text-foreground"
        )}
      >
        clawback
      </span>
    </span>
  );
}
