import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Boxes,
  Fingerprint,
  KeyRound,
  ShieldBan,
  TrendingUp,
  Users,
} from "lucide-react";

import { PageHeader, StatCard, EmptyState, Badge } from "@/components/ui";
import { TrafficChart, RankedBars } from "@/components/admin/traffic-chart";
import { requireAdminPage } from "@/lib/authorization";
import {
  getPlatformStats,
  getPlanDistribution,
  getRecentPlatformEvents,
  getTopFailingUsernames,
  getTopIps,
  getTrafficSeries,
} from "@/lib/admin-data";
import { listPlans } from "@/lib/plan-catalog";
import { formatRelative } from "@/lib/cn";

export const metadata = { title: "Admin overview" };

const ACTION_TONE: Record<string, "success" | "danger" | "warn" | "info" | "neutral"> = {
  LOGIN_SUCCESS: "success",
  LOGIN_FAILED: "danger",
  ACCOUNT_BANNED: "danger",
  ACCOUNT_UNBANNED: "success",
  ACCOUNT_EXPIRED: "warn",
  DEVICE_ADDED: "info",
  SESSION_REVOKED: "neutral",
  LOGOUT: "neutral",
};

/** Platform-wide dashboard: totals, traffic trend and a live event feed. */
export default async function AdminOverviewPage() {
  await requireAdminPage();

  const [stats, series, events, topIps, topUsernames, planCounts] = await Promise.all([
    getPlatformStats(),
    getTrafficSeries(14),
    getRecentPlatformEvents(12),
    getTopIps(6),
    getTopFailingUsernames(6),
    getPlanDistribution(),
  ]);

  const attempts = stats.loginsWeek + stats.failuresWeek;
  const successRate = attempts === 0 ? 100 : Math.round((stats.loginsWeek / attempts) * 100);

  return (
    <div className="mx-auto max-w-7xl px-5 py-7 sm:px-7 lg:px-9">
      <PageHeader
        title="Platform overview"
        description="Every customer, application and authentication event across FastAuth."
        action={
          <span className="badge border border-danger-500/30 bg-danger-900/40 text-danger-400">
            Operator access
          </span>
        }
      />

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Customers" value={stats.customers} icon={Users} />
        <StatCard label="Applications" value={stats.applications} icon={Boxes} tone="info" />
        <StatCard
          label="Application users"
          value={stats.totalAppUsers}
          icon={KeyRound}
          hint={`${stats.activeAppUsers} active`}
        />
        <StatCard label="Devices" value={stats.devices} icon={Fingerprint} hint="registered" />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Logins today" value={stats.loginsToday} icon={TrendingUp} tone="success" />
        <StatCard
          label="Failed / 7d"
          value={stats.failuresWeek}
          icon={AlertTriangle}
          tone={stats.failuresWeek > 0 ? "warn" : "neutral"}
        />
        <StatCard label="Live sessions" value={stats.activeSessions} icon={Activity} tone="info" />
        <StatCard
          label="Banned users"
          value={stats.bannedAppUsers}
          icon={ShieldBan}
          tone="danger"
          hint={`${stats.expiredAppUsers} expired`}
        />
      </div>

      <section className="card mt-4 p-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Authentication traffic</h2>
            <p className="mt-0.5 text-[12px] text-ink-muted">
              Successful vs failed logins, last 14 days
            </p>
          </div>
          <span className="badge border border-success-500/30 bg-success-900/40 text-success-400">
            {successRate}% success (7d)
          </span>
        </header>
        <div className="mt-5">
          <TrafficChart data={series} />
        </div>
      </section>

      <section className="card mt-4 p-5">
        <header>
          <h2 className="text-sm font-semibold text-ink">Subscription tiers</h2>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            How customers are distributed across plans.
          </p>
        </header>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {listPlans().map((plan) => (
            <div key={plan.id} className="rounded-lg border border-line bg-surface-850 p-3">
              <div className="flex items-baseline justify-between">
                <p className="text-[13px] font-medium text-ink">{plan.label}</p>
                <p className="tnum text-lg font-semibold text-ink">
                  {planCounts[plan.id] ?? 0}
                </p>
              </div>
              <p className="mt-1 text-[11px] text-ink-subtle">
                {plan.appLimit === null ? "Unlimited apps" : `Up to ${plan.appLimit} apps`}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <header className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Activity className="h-4 w-4 text-ink-subtle" />
            <h2 className="text-sm font-semibold text-ink">Live event feed</h2>
          </header>
          {events.length === 0 ? (
            <EmptyState title="No events yet" icon={Activity} />
          ) : (
            <ul className="divide-y divide-line">
              {events.map((event) => (
                <li key={event.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Badge tone={ACTION_TONE[event.action] ?? "neutral"}>
                    {event.action.replace(/_/g, " ")}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    {event.username ?? "—"}
                    <span className="ml-2 text-[11px] text-ink-subtle">
                      {event.application}
                    </span>
                  </span>
                  <span className="hidden shrink-0 font-mono text-[11px] text-ink-subtle sm:block">
                    {event.ip ?? "—"}
                  </span>
                  <span className="shrink-0 text-[12px] text-ink-subtle">
                    {formatRelative(event.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-4">
          <section className="card p-4">
            <h2 className="text-sm font-semibold text-ink">Top attacking IPs</h2>
            <p className="mt-0.5 text-[12px] text-ink-muted">By failed attempts</p>
            <div className="mt-4">
              {topIps.length === 0 ? (
                <p className="py-4 text-center text-[13px] text-ink-muted">
                  No failed attempts.
                </p>
              ) : (
                <RankedBars entries={topIps} tone="danger" />
              )}
            </div>
          </section>

          <section className="card p-4">
            <h2 className="text-sm font-semibold text-ink">Most failed usernames</h2>
            <p className="mt-0.5 text-[12px] text-ink-muted">Guessing targets</p>
            <div className="mt-4">
              {topUsernames.length === 0 ? (
                <p className="py-4 text-center text-[13px] text-ink-muted">
                  No failed attempts.
                </p>
              ) : (
                <RankedBars entries={topUsernames} tone="danger" />
              )}
            </div>
          </section>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {[
          ["/admin/customers", "All customers"],
          ["/admin/applications", "All applications"],
          ["/admin/app-users", "All application users"],
          ["/admin/devices", "All devices"],
          ["/admin/sessions", "All sessions"],
          ["/admin/logs", "Full audit log"],
        ].map(([href, label]) => (
          <Link key={href} href={href} className="btn btn-sm btn-secondary">
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
