import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Horizontally scrollable container for data tables.
 *
 * Dense tables need more width than a phone has. Rather than hide columns or
 * force the whole page to scroll sideways, the overflow is CONTAINED here: the
 * table scrolls inside its card and the page stays put.
 *
 * The right-edge fade is a deliberate affordance. Without it a clipped table
 * just looks broken; with it, the cut-off column reads as "there is more this
 * way". It is hidden from `sm` up, where the table fits anyway.
 */
export function TableScroll({
  children,
  label,
  className,
}: {
  children: ReactNode;
  /** Describes the table for screen readers, since it is a scrollable region. */
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      {/*
        tabIndex makes the region keyboard-scrollable, which is the standard
        fix for content that scrolls but has no focusable children.
      */}
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className="table-scroll focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {children}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-surface-900 via-surface-900/70 to-transparent sm:hidden"
      />
    </div>
  );
}
