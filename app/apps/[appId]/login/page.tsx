import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { PortalLoginForm } from "@/components/portal/portal-login-form";
import { findApplicationByAppId } from "@/lib/application";
import { getPortalUserForApp } from "@/lib/portal-auth";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Sign-in for one application's end users: `/apps/<appId>/login`.
 *
 * The application is already resolved and rendered by the layout, so this page
 * only has to decide ONE thing — is this person already signed in to THIS
 * application?
 *
 * If they are, send them to their dashboard. If they are signed in to a
 * DIFFERENT application, the check below deliberately fails and the login form
 * renders: an end-user cookie is per-application in effect (see
 * `getPortalUserForApp`), so signing in to app A must never silently satisfy
 * app B's dashboard.
 *
 * Deliberately NOT inside the `(auth)` route group: that layout redirects an
 * already-signed-in visitor to `/dashboard` and keys on `fa_session`, which an
 * end user never holds. The dashboard customers keep `/login` and `/dashboard`.
 */
export default async function AppPortalLoginPage({
  params,
}: {
  params: Promise<{ appId: string }>;
}) {
  const { appId } = await params;
  const application = await findApplicationByAppId(appId);

  // The layout already 404s an unknown application, so this cannot be null in
  // practice; the guard keeps the type honest rather than asserting it.
  if (application) {
    const session = await getPortalUserForApp(application._id.toString());
    if (session) {
      redirect(`/apps/${encodeURIComponent(appId)}/dashboard`);
    }
  }

  return (
    // `mx-auto` centres the narrow card in the layout's column on a wide
    // screen; `my-auto` is what centres it VERTICALLY between the header and
    // the footer, because the layout's `main` is a flex column. On a phone the
    // card is simply full width, and `w-full` keeps the form from collapsing
    // to its input's intrinsic size there.
    <div className="mx-auto my-auto w-full max-w-[400px]">
      <header className="mb-6 sm:mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          Manage your account and devices.
        </p>
      </header>
      <PortalLoginForm appId={appId} />
    </div>
  );
}