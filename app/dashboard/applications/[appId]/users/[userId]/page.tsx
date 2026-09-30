import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Fingerprint, KeyRound, ShieldBan } from "lucide-react";

import { Badge, EmptyState, UserStatusBadge } from "@/components/ui";
import { Detail } from "@/components/ui/detail";
import { UserActions } from "@/components/dashboard/user-actions";
import { requireAppUser } from "@/lib/authorization";
import { getAppUser } from "@/lib/app-user";
import { listAppSessions } from "@/lib/app-session";
import { listDevices } from "@/lib/device";
import { formatDate, formatDateTime, describeExpiration } from "@/lib/cn";

export const metadata: Metadata = { title: "User" };

/** Single application user: status, devices, sessions and actions. */
export default async function AppUserDetailPage({
  params,
}: PageProps<"/dashboard/applications/[appId]/users/[userId]">) {
  const { appId, userId } = await params;

  // Proves: caller owns the application AND the user belongs to it.
  await requireAppUser(appId, userId);

  const [user, devices, sessions] = await Promise.all([
    getAppUser(appId, userId),
    listDevices(appId, { page: 1, limit: 25, userId }),
    listAppSessions(appId, { page: 1, limit: 25, userId }),
  ]);

  const devicesUsed = devices.total;
  const activeSessions = sessions.sessions.filter((s) => s.isActive).length;

  return (
    <div className="space-y-5">
      <Link
        href={`/dashboard/applications/${appId}/users`}
        className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All users
      </Link>

      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">{user.name}</h2>
          <p className="font-mono text-[12px] text-ink-subtle">{user.username}</p>
        </div>
        <UserStatusBadge
          isBanned={user.isBanned}
          isExpired={user.isExpired}
          lifetime={user.expiresAt === null}
        />
        {user.isBanned ? (
          <span className="flex items-center gap-1.5 text-[12px] text-ink-subtle">
            <ShieldBan className="h-3.5 w-3.5" />
            {user.banReason}
          </span>
        ) : null}
      </header>

      <section className="card p-5">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Expires">{describeExpiration(user.expiresAt)}</Detail>
          <Detail label="Devices used">
            <span className="tnum">
              {devicesUsed} / {user.maxDevices}
            </span>
          </Detail>
          <Detail label="Active sessions">
            <span className="tnum">{activeSessions}</span>
          </Detail>
          <Detail label="Last login">
            {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"}
          </Detail>
          <Detail label="Created">{formatDate(user.createdAt)}</Detail>
          <Detail label="Banned at">{user.bannedAt ? formatDateTime(user.bannedAt) : "—"}</Detail>
        </div>
      </section>

      <section className="card p-5">
        <h3 className="text-sm font-semibold text-ink">Actions</h3>
        <div className="mt-4">
          <UserActions
            appId={appId}
            userId={userId}
            isBanned={user.isBanned}
            devicesUsed={devicesUsed}
            activeSessions={activeSessions}
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <header className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Fingerprint className="h-4 w-4 text-ink-subtle" />
            <h3 className="text-sm font-semibold text-ink">Registered devices</h3>
            <Link
              href={`/dashboard/applications/${appId}/users/${userId}/devices`}
              className="ml-auto text-[12px] font-medium text-accent hover:underline"
            >
              Manage devices
            </Link>
          </header>
          {devices.devices.length === 0 ? (
            <EmptyState title="No devices" icon={Fingerprint} />
          ) : (
            <ul className="divide-y divide-line">
              {devices.devices.map((device) => (
                <li key={device.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[12px] text-ink">{device.deviceId}</p>
                    <p className="text-[11px] text-ink-subtle">
                      {device.platform ?? "Unknown"} · {formatDateTime(device.lastSeenAt)}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-ink-subtle">{device.lastIp ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <header className="flex items-center gap-2 border-b border-line px-4 py-3">
            <KeyRound className="h-4 w-4 text-ink-subtle" />
            <h3 className="text-sm font-semibold text-ink">Sessions</h3>
          </header>
          {sessions.sessions.length === 0 ? (
            <EmptyState title="No sessions" icon={KeyRound} />
          ) : (
            <ul className="divide-y divide-line">
              {sessions.sessions.slice(0, 10).map((session) => (
                <li key={session.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[12px] text-ink">{session.deviceId}</p>
                    <p className="text-[11px] text-ink-subtle">{formatDateTime(session.createdAt)}</p>
                  </div>
                  {session.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Ended</Badge>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
