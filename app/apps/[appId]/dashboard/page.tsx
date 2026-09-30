import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarClock, Gauge, ShieldCheck } from "lucide-react";

import { PortalAccountForms } from "@/components/portal/portal-account-forms";
import { PortalSignOut } from "@/components/portal/portal-sign-out";
import { findApplicationByAppId } from "@/lib/application";
import { getPortalProfile, listPortalDevices } from "@/lib/portal";
import { requirePortalUserPage } from "@/lib/portal-auth";

export const metadata: Metadata = { title: "Your account" };

/** "Never" for a lifetime account, otherwise a readable date. */
function expiryLabel(expiresAt: string | null): string {
  if (!expiresAt) return "Never";
  return new Date(expiresAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * One application's end-user dashboard: `/apps/<appId>/dashboard`.
 *
 * Everything here is about ONE account: the one in the session, belonging to
 * the application in the URL. There is no id in the URL and none in any button,
 * so there is no cross-account navigation to get wrong.
 *
 * `requirePortalUserPage` is given BOTH halves deliberately. It resolves the
 * cookie to a user AND checks that user belongs to this application, so a
 * cookie minted for app A cannot render app A's account underneath app B's
 * name. That comparison is the whole reason per-application URLs are safe with
 * a single shared cookie.
 *
 * Rendered on the server from live data, so a ban or an expiry takes effect on
 * the next load rather than waiting for a client refresh.
 */
export default async function AppPortalDashboardPage({
  params,
}: {
  params: Promise<{ appId: string }>;
}) {
  const { appId } = await params;
  const application = await findApplicationByAppId(appId);
  if (!application) notFound();
  const applicationObjectId = application._id.toString();

  // Redirects to THIS application's sign-in page when there is no session for
  // it, so a person is never sent to sign in somewhere they cannot complete.
  const session = await requirePortalUserPage(applicationObjectId, appId);

  // Two independent reads; neither needs the other's result.
  const [profile, deviceList] = await Promise.all([
    getPortalProfile(session.id, session.applicationId),
    listPortalDevices(session.id, session.applicationId),
  ]);

  return (
    <div className="w-full">
      {/* Stacks on a phone — the sign-out button drops below the greeting
          instead of squeezing the name into a narrow column beside it.
          `min-w-0` on the text side lets the name WRAP rather than push the
          button off-screen, which is what a long display name would do. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold tracking-tight">
            Hello, {profile.name}
          </h1>
          <p className="mt-1.5 break-words text-sm text-ink-muted">
            Your account on {profile.applicationName ?? application.name}.
          </p>
        </div>
        <div className="w-full shrink-0 sm:w-auto">
          <PortalSignOut appId={appId} />
        </div>
      </div>

      {/* The three facts worth seeing at a glance: when this ends, how many
          seats are used, and whether the account is currently in good standing.
          One column on a phone, three from `sm` up. `min-w-0` plus `break-words`
          keeps a long localised expiry date ("30 September 2026") on one line
          where it fits and wrapping cleanly where it does not, rather than
          overflowing the card. */}
      <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="min-w-0 rounded-xl border border-line bg-surface-900 p-4">
          <dt className="flex items-center gap-2 text-[12px] uppercase tracking-wide text-ink-subtle">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
            Expires
          </dt>
          <dd className="tnum mt-1.5 break-words text-[15px] font-medium text-ink">
            {expiryLabel(profile.expiresAt)}
          </dd>
        </div>
        <div className="min-w-0 rounded-xl border border-line bg-surface-900 p-4">
          <dt className="flex items-center gap-2 text-[12px] uppercase tracking-wide text-ink-subtle">
            <Gauge className="h-3.5 w-3.5 shrink-0" />
            Devices
          </dt>
          <dd className="tnum mt-1.5 break-words text-[15px] font-medium text-ink">
            {profile.devicesUsed} of {profile.maxDevices}
          </dd>
        </div>
        <div className="min-w-0 rounded-xl border border-line bg-surface-900 p-4">
          <dt className="flex items-center gap-2 text-[12px] uppercase tracking-wide text-ink-subtle">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            Status
          </dt>
          <dd className="mt-1.5 break-words text-[15px] font-medium text-brand-400">Active</dd>
        </div>
      </dl>

      <div className="mt-6">
        <PortalAccountForms
          profile={profile}
          devices={deviceList.devices}
          idleMinutes={deviceList.idleMinutes}
        />
      </div>
    </div>
  );
}