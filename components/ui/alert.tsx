"use client";

import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";

import { cn } from "@/lib/cn";

type Variant = "error" | "success" | "info" | "warning";

export type AlertMessage = {
  variant: Variant;
  message: string;
  /** Optional per-field messages shown beneath inputs. */
  fields?: Record<string, string>;
};

const VARIANTS: Record<Variant, { icon: typeof AlertCircle; classes: string }> = {
  error: { icon: XCircle, classes: "border-danger-500/30 bg-danger-900/40 text-danger-400" },
  success: { icon: CheckCircle2, classes: "border-success-500/30 bg-success-900/40 text-success-400" },
  warning: { icon: AlertCircle, classes: "border-warn-500/30 bg-warn-900/40 text-warn-400" },
  info: { icon: Info, classes: "border-info-500/30 bg-info-900/40 text-info-400" },
};

/**
 * Inline banner used at the top of forms and inside confirmation dialogs.
 * Rendered either as `<Alert {...message} />` or with JSX children.
 */
export function Alert({
  variant,
  message,
  children,
}: Omit<AlertMessage, "message"> & { message?: string; children?: ReactNode }) {
  const { icon: Icon, classes } = VARIANTS[variant];
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]",
        classes,
      )}
    >
      <Icon className="mt-px h-4 w-4 shrink-0" />
      <span className="min-w-0">{children ?? message}</span>
    </div>
  );
}

/** Per-field error text, rendered directly beneath an input. */
export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1.5 text-[12px] text-danger-400">{message}</p>;
}

/** Consistent inline spinner for submitting buttons. */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin", className)} />;
}
