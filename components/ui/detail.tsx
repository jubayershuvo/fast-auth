import type { ReactNode } from "react";

/** Small uppercase label used above values. */
export function Label({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-wider text-ink-subtle break-anywhere">
      {children}
    </p>
  );
}

/** Key/value pair used in detail panels. */
export function Detail({
  label,
  children,
  mono,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label>{label}</Label>
      {/*
        `break-anywhere` is load-bearing: these values include application ids,
        secret fingerprints and user agents, which contain no spaces. Without
        it a single long value forces the entire page to scroll sideways on a
        phone, because a plain block does not otherwise wrap.
      */}
      <div
        className={
          mono
            ? "break-anywhere font-mono text-[13px] text-ink"
            : "break-anywhere text-sm text-ink"
        }
      >
        {children}
      </div>
    </div>
  );
}
