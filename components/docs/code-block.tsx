"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/cn";
import { substituteBaseUrl } from "@/lib/api-docs/base-url";
import { useBaseUrl } from "@/components/docs/use-base-url";

/**
 * Copy-to-clipboard code block used throughout the documentation.
 *
 * The domain is not hardcoded: any `{{BASE_URL}}` placeholder in the example is
 * replaced with the origin the reader is currently on, so the snippets are
 * correct on every self-hosted deployment.
 */
export function CodeBlock({
  code,
  lang = "bash",
}: {
  code: string;
  lang?: string;
}) {
  const [copied, setCopied] = useState(false);
  const baseUrl = useBaseUrl();
  const resolved = substituteBaseUrl(code, baseUrl);

  async function copy() {
    try {
      await navigator.clipboard.writeText(resolved);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked on an insecure origin; the code is selectable.
    }
  }

  return (
    <div className="group relative">
      <div className="flex items-center justify-between border-b border-line bg-surface-850 px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-subtle">
          {lang}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy code"
          className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] text-ink-subtle transition-colors hover:text-ink"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-success-400" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre
        className={cn(
          "overflow-x-auto bg-surface-950 px-3.5 py-3 font-mono text-[12px] leading-relaxed text-ink-muted",
        )}
      >
        <code>{resolved}</code>
      </pre>
    </div>
  );
}

/** Inline `code` chip for prose. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-surface-800 px-1 py-0.5 font-mono text-[12px] text-brand-300">
      {children}
    </code>
  );
}
