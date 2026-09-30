"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * `true` only after hydration on the client.
 *
 * Uses `useSyncExternalStore` rather than a `useState` + `useEffect` pair: the
 * effect-based version sets state during the effect body, which triggers a
 * cascading second render and is flagged by react-hooks v6.
 */
const noopSubscribe = () => () => {};
function useIsHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,  // client snapshot
    () => false, // server snapshot
  );
}

/**
 * Accessible modal rendered in a portal.
 *
 * Handles Escape-to-close and click-outside, and locks body scroll while open.
 * Native <dialog> is avoided so the styling stays consistent across browsers.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  // The portal target only exists on the client.
  const hydrated = useIsHydrated();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open || !hydrated) return null;

  const width = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" }[size];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative z-10 flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface-900 shadow-2xl sm:rounded-2xl",
          width,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {description ? (
              <p className="mt-1 text-[13px] text-ink-muted">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn btn-sm btn-ghost shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-line bg-surface-850 px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
