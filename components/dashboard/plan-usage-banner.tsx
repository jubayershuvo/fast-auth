import type { PlanUsage } from "@/lib/plans";
import { cn } from "@/lib/cn";

/**
 * Plan + usage banner for the customer dashboard.
 *
 * Shows how many application seats remain and, when the account is over its
 * cap after a downgrade, says so plainly instead of failing at create time.
 */
export function PlanUsageBanner({ usage }: { usage: PlanUsage }) {
  const { plan, used, limit, overLimit } = usage;

  const unlimited = limit === null;
  const remaining = unlimited ? null : Math.max(0, limit - used);
  const pct = unlimited
    ? 0
    : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));

  const barTone = overLimit
    ? "bg-danger-500"
    : remaining === 0
      ? "bg-warn-500"
      : "bg-brand-500";

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-ink-subtle">
            Subscription
          </p>
          <p className="mt-0.5 text-[15px] font-semibold text-ink">
            {plan.label}
            <span className="ml-2 text-[12px] font-normal text-ink-muted">
              {plan.priceLabel}
            </span>
          </p>
        </div>
        <p className="tnum text-sm text-ink-muted">
          <span className="text-ink">{used}</span>
          {unlimited ? " applications" : ` of ${limit} applications`}
        </p>
      </div>

      {unlimited ? null : (
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-800"
          role="progressbar"
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={limit}
        >
          <div className={cn("h-full rounded-full", barTone)} style={{ width: `${pct}%` }} />
        </div>
      )}

      {overLimit ? (
        <p className="mt-3 text-[12px] text-danger-400">
          You have more applications than the {plan.label} plan allows. Delete{" "}
          {used - (limit ?? 0)} to create new ones, or contact support to upgrade.
        </p>
      ) : remaining === 0 ? (
        <p className="mt-3 text-[12px] text-warn-400">
          You have used every application on the {plan.label} plan. Contact support to
          upgrade for more.
        </p>
      ) : null}
    </div>
  );
}
