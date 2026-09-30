import type { Metadata } from "next";
import { ShieldCheck, Database, KeyRound } from "lucide-react";

import { PageHeader } from "@/components/ui";
import { Detail } from "@/components/ui/detail";
import { ChangePasswordForm } from "@/components/dashboard/change-password-form";
import { ProfileNameForm } from "@/components/dashboard/profile-name-form";
import { requireDashboardUserPage } from "@/lib/authorization";
import { listActiveSessions } from "@/lib/session";
import { formatDateTime } from "@/lib/cn";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Settings" };

/** Account security: change password and review active dashboard sessions. */
export default async function SettingsPage() {
  const user = await requireDashboardUserPage();
  const sessions = await listActiveSessions(user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-5 py-7 sm:px-7 lg:px-9">
      <PageHeader title="Settings" description="Manage your account and active sessions." />

      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink">Account</h2>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Detail label="Email">{user.email}</Detail>
          <Detail label="Username">{user.username}</Detail>
        </div>
        <div className="mt-5 border-t border-line pt-4">
          <ProfileNameForm initialName={user.name} />
        </div>
      </section>

      <section className="card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <KeyRound className="h-4 w-4 text-ink-subtle" />
          Change password
        </h2>
        <p className="mt-1.5 text-[13px] text-ink-muted">
          Changing your password signs you out of every other browser.
        </p>
        <div className="mt-4">
          <ChangePasswordForm />
        </div>
      </section>

      <section className="card overflow-hidden">
        <header className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <ShieldCheck className="h-4 w-4 text-ink-subtle" />
          <h2 className="text-sm font-semibold text-ink">Active sessions</h2>
        </header>
        {sessions.length === 0 ? (
          <p className="px-5 py-6 text-center text-[13px] text-ink-muted">No active sessions.</p>
        ) : (
          <ul className="divide-y divide-line">
            {sessions.map((session) => (
              <li key={session._id.toString()} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-ink">
                    {session.userAgent ?? "Unknown device"}
                  </p>
                  <p className="font-mono text-[11px] text-ink-subtle">{session.ip ?? "unknown ip"}</p>
                </div>
                <span className="shrink-0 text-[12px] text-ink-subtle">
                  until {formatDateTime(session.expiresAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Database className="h-4 w-4 text-ink-subtle" />
          Environment
        </h2>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Detail label="Environment">{env.isProd ? "Production" : "Development"}</Detail>
          <Detail label="Session cookie">{env.cookieSecure ? "Secure (HTTPS only)" : "Not secure (HTTP)"}</Detail>
        </div>
      </section>
    </div>
  );
}
