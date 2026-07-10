"use client";

import { usePathname } from "next/navigation";

/**
 * § 1.4 boundary surfacing (invariant 6) — the header always states which side of the
 * output boundary the human is viewing. Every surface is a window, never a door:
 *  - /pair session view = ●Inside  (looking through the window into a member session)
 *  - everything else    = ○Outside (standing in the public square)
 */
export function BoundaryChip() {
  const path = usePathname();
  const inside = path?.startsWith("/pair") ?? false;
  return (
    <span
      className={`boundary-chip ${inside ? "inside" : "outside"}`}
      title={
        inside
          ? "Inside — a member session, seen through the window"
          : "Outside — you watch from the square. Humans never step in."
      }
    >
      <span className="dot" aria-hidden />
      {inside ? "Inside" : "Outside"}
    </span>
  );
}
