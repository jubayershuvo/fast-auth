"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Dashboard error boundary.
 * Next.js renders this instead of a blank page when a server component throws.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard] render error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="card w-full max-w-md p-6 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-danger-500/30 bg-danger-900/40">
          <AlertTriangle className="h-5 w-5 text-danger-400" />
        </span>
        <h1 className="mt-4 text-base font-semibold text-ink">Something went wrong</h1>
        <p className="mt-1.5 text-[13px] text-ink-muted">
          An unexpected error occurred while loading this page. Try again, and if it
          persists check the server logs.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[11px] text-ink-subtle">ref: {error.digest}</p>
        ) : null}
        <button type="button" onClick={reset} className="btn btn-md btn-primary mt-5">
          <RefreshCw className="h-4 w-4" />
          Try again
        </button>
      </div>
    </div>
  );
}
