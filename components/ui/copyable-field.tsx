"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/cn";
import { Label } from "@/components/ui/detail";

/**
 * Read-only field with a copy button, used for app ids and one-time secrets.
 * Client-side only because it needs clipboard + transient state.
 */
export function CopyableField({
  value,
  label,
  hint,
  tone = "default",
}: {
  value: string;
  label: string;
  hint?: string;
  tone?: "default" | "warning";
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked (insecure origin); the value is selectable.
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2",
          tone === "warning"
            ? "border-warn-500/40 bg-warn-900/30"
            : "border-line-strong bg-surface-950",
        )}
      >
        <code
          className={cn(
            "min-w-0 flex-1 truncate font-mono text-[13px]",
            tone === "warning" ? "text-warn-400" : "text-ink",
          )}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label}`}
          className="btn btn-sm btn-ghost shrink-0"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-success-400" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      {hint ? <p className="text-[12px] text-ink-subtle">{hint}</p> : null}
    </div>
  );
}
