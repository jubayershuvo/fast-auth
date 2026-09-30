import type { ReactNode } from "react";
import { AlertTriangle, Inbox } from "lucide-react";

import { cn } from "@/lib/cn";

type Tone = "success" | "danger" | "warn" | "neutral" | "info";

const TONES: Record<Tone, string> = {
  success: "bg-success-900/50 text-success-400 border-success-500/30",
  danger: "bg-danger-900/50 text-danger-400 border-danger-500/30",
  warn: "bg-warn-900/50 text-warn-400 border-warn-500/30",
  info: "bg-info-900/50 text-info-400 border-info-500/30",
  neutral: "bg-surface-800 text-ink-muted border-line-strong",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return <span className={cn("badge border", TONES[tone])}>{children}</span>;
}

/** Derive a status badge from an application user's flags. */
export function UserStatusBadge({
  isBanned,
  isExpired,
  lifetime,
}: {
  isBanned: boolean;
  isExpired: boolean;
  lifetime: boolean;
}) {
  if (isBanned) return <Badge tone="danger">Banned</Badge>;
  if (isExpired) return <Badge tone="warn">Expired</Badge>;
  if (lifetime) return <Badge tone="info">Lifetime</Badge>;
  return <Badge tone="success">Active</Badge>;
}

/** Metric card for the overview page. */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: number | string;
  icon: typeof Inbox;
  tone?: Tone;
  hint?: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[12px] font-medium uppercase tracking-wider text-ink-subtle">
            {label}
          </p>
          <p className="tnum mt-2 text-2xl font-semibold text-ink">{value}</p>
          {hint ? <p className="mt-1 text-[12px] text-ink-subtle">{hint}</p> : null}
        </div>
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
            TONES[tone],
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}

/** Consistent empty state for every table and list. */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: typeof Inbox;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-800">
        <Icon className="h-5 w-5 text-ink-subtle" />
      </span>
      <h3 className="mt-4 text-sm font-medium text-ink">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-sm text-[13px] text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Destructive-action warning banner. */
export function DangerNotice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-danger-500/30 bg-danger-900/30 px-3 py-2.5 text-[13px] text-danger-400">
      <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** Page header used across the dashboard. */
export function PageHeader({
  title,
  description,
  action,
  breadcrumb,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {breadcrumb ? <div className="mb-2">{breadcrumb}</div> : null}
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  );
}
