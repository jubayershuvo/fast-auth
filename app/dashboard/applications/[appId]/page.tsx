import type { Metadata } from "next";
import { CheckCircle2, Clock, Fingerprint, ShieldAlert, Users, Activity, Copy, PauseCircle } from "lucide-react";

import { StatCard, Badge } from "@/components/ui";
import { Detail } from "@/components/ui/detail";
import { ApplicationStatusToggle } from "@/components/dashboard/application-actions";
import { requireApplicationOwnerPage } from "@/lib/authorization";
import { getApplicationStats } from "@/lib/stats";
import { listAppUsers } from "@/lib/app-user";
import { formatRelative } from "@/lib/cn";
import { ApiExample } from "@/components/dashboard/api-example";

export const metadata: Metadata = { title: "Application" };

/** Application overview: counters, integration snippet and recent sign-ins. */
export default async function ApplicationOverviewPage({
  params,
}: PageProps<"/dashboard/applications/[appId]">) {
  const { appId } = await params;
  // Ownership verified by the layout, re-verified here for the data read.
  const application = await requireApplicationOwnerPage(appId);

  const [stats, recentUsers] = await Promise.all([
    getApplicationStats(appId),
    listAppUsers(appId, { page: 1, limit: 5 }),
  ]);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total users" value={stats.totalUsers} icon={Users} />
        <StatCard label="Active" value={stats.activeUsers} icon={CheckCircle2} tone="success" />
        <StatCard label="Banned" value={stats.bannedUsers} icon={ShieldAlert} tone="danger" />
        <StatCard label="Expired" value={stats.expiredUsers} icon={Clock} tone="warn" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Devices" value={stats.totalDevices} icon={Fingerprint} tone="info" />
        <StatCard
          label="Live sessions"
          value={stats.activeSessions}
          icon={Activity}
          tone="info"
        />
        <StatCard
          label="Failed logins"
          value={stats.failuresLast7Days}
          icon={ShieldAlert}
          tone={stats.failuresLast7Days > 0 ? "warn" : "neutral"}
          hint="Last 7 days"
        />
      </div>

      <ApiExample appId={application.appId} />

      <section className="card">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Newest users</h2>
          <a
            href={`/dashboard/applications/${appId}/users`}
            className="text-[13px] text-brand-400 hover:text-brand-300"
          >
            Manage all
          </a>
        </header>

        {recentUsers.users.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-ink-muted">
            No users yet. Add your first end user to start issuing credentials.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {recentUsers.users.map((user) => (
              <li key={user.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{user.username}</p>
                  <p className="text-[11px] text-ink-subtle">
                    Added {formatRelative(user.createdAt)}
                  </p>
                </div>
                <span className="shrink-0">
                  {user.isBanned ? (
                    <Badge tone="danger">Banned</Badge>
                  ) : user.isExpired ? (
                    <Badge tone="warn">Expired</Badge>
                  ) : (
                    <Badge tone="success">Active</Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {application.status === "suspended" ? (
        /*
          Persisted, not transient. An owner who stops an app and comes back
          tomorrow must still SEE that it is stopped — a toast that has already
          faded leaves no trace of why nobody can log in.
        */
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3"
        >
          <p className="flex items-center gap-2 text-[13px] text-ink">
            <PauseCircle className="h-4 w-4 shrink-0 text-warn" />
            This application is stopped. No end user can sign in, and existing
            sessions are refused, until you start it again.
          </p>
          <ApplicationStatusToggle appId={appId} status={application.status} />
        </div>
      ) : null}

      <section className="card p-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Integration details</h2>
          {/* When stopped, the banner above already carries the Start button. */}
          {application.status === "suspended" ? null : (
            <ApplicationStatusToggle appId={appId} status="active" />
          )}
        </header>
        <div className="mt-4 grid gap-5 sm:grid-cols-3">
          <Detail label="Application ID" mono>
            <span className="inline-flex items-center gap-1.5 break-all">
              {application.appId}
              <Copy className="h-3 w-3 shrink-0 text-ink-subtle" />
            </span>
          </Detail>
          <Detail label="Secret fingerprint" mono>
            ••••{application.appSecretFingerprint}
          </Detail>
          <Detail label="Secret last rotated">{formatRelative(application.appSecretRotatedAt)}</Detail>
        </div>
      </section>
    </div>
  );
}
