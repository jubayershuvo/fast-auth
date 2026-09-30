import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Clock,
  Fingerprint,
  KeyRound,
  ShieldAlert,
  Users,
} from "lucide-react";

import { PageHeader, StatCard, EmptyState, Badge } from "@/components/ui";
import { requireDashboardUserPage } from "@/lib/authorization";
import { getDashboardOverview } from "@/lib/stats";
import { formatRelative } from "@/lib/cn";

export const metadata = { title: "Overview" };

const ACTION_TONE: Record<string, "success" | "danger" | "warn" | "info" | "neutral"> = {
  LOGIN_SUCCESS: "success",
  LOGIN_FAILED: "danger",
  ACCOUNT_BANNED: "danger",
  ACCOUNT_UNBANNED: "success",
  ACCOUNT_EXPIRED: "warn",
  DEVICE_ADDED: "info",
  DEVICE_REMOVED: "neutral",
  SESSION_CREATED: "info",
  SESSION_REVOKED: "neutral",
  LOGOUT: "neutral",
};

/** Dashboard home: portfolio-wide totals plus a live event feed. */
export default async function DashboardHome() {
  const user = await requireDashboardUserPage();
  const stats = await getDashboardOverview(user.id);

  return (
    <div className="mx-auto max-w-6xl px-5 py-7 sm:px-7 lg:px-9">
      <PageHeader
        title={`Welcome back, ${user.username}`}
        description="Portfolio overview across all of your applications."
      />

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Applications" value={stats.applicationCount} icon={Boxes} tone="info" />
        <StatCard
          label="Total users"
          value={stats.totalUsers}
          icon={Users}
          hint={`${stats.activeUsers} active`}
        />
        <StatCard
          label="Devices"
          value={stats.totalDevices}
          icon={Fingerprint}
          hint={`${stats.activeSessions} live sessions`}
        />
        <StatCard
          label="Failed logins"
          value={stats.failuresLast7Days}
          icon={ShieldAlert}
          tone={stats.failuresLast7Days > 0 ? "warn" : "neutral"}
          hint="Last 7 days"
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <StatCard label="Active users" value={stats.activeUsers} icon={CheckCircle2} tone="success" />
        <StatCard label="Banned users" value={stats.bannedUsers} icon={ShieldAlert} tone="danger" />
        <StatCard label="Expired users" value={stats.expiredUsers} icon={Clock} tone="warn" />
      </div>


      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        {/* Recent authentication events */}
        <section className="card lg:col-span-3">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-ink-subtle" />
              <h2 className="text-sm font-semibold text-ink">Recent activity</h2>
            </div>
          </header>

          {stats.recentEvents.length === 0 ? (
            <EmptyState
              title="No activity yet"
              description="Authentication events from your applications will appear here."
              icon={Activity}
            />
          ) : (
            <ul className="divide-y divide-line">
              {stats.recentEvents.map((event) => (
                <li key={event.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Badge tone={ACTION_TONE[event.action] ?? "neutral"}>
                    {event.action.replace(/_/g, " ")}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    {event.username ?? "—"}
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

        {/* Applications shortcut */}
        <section className="card lg:col-span-2">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-ink-subtle" />
              <h2 className="text-sm font-semibold text-ink">Your applications</h2>
            </div>
            <Link
              href="/dashboard/applications"
              className="text-[13px] text-brand-400 hover:text-brand-300"
            >
              Manage
            </Link>
          </header>

          {stats.applications.length === 0 ? (
            <EmptyState
              title="No applications yet"
              description="Create your first application to start issuing licenses."
              icon={Boxes}
              action={
                <Link href="/dashboard/applications" className="btn btn-sm btn-primary">
                  Create application
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {stats.applications.slice(0, 6).map((app) => (
                <li key={app.id}>
                  <Link
                    href={`/dashboard/applications/${app.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-850"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-ink">{app.name}</p>
                      <p className="truncate font-mono text-[11px] text-ink-subtle">{app.appId}</p>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {stats.applicationCount === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Get started in three steps"
            description="Create an application, add your end users, then call the login API from your game or software."
            icon={KeyRound}
            action={
              <Link href="/dashboard/applications" className="btn btn-md btn-primary">
                Create your first application
              </Link>
            }
          />
        </div>
      ) : null}
    </div>
  );
}
