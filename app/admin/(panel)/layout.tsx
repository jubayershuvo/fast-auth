import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { ToastProvider } from "@/components/ui/toast";
import { requireAdminPage } from "@/lib/authorization";

/**
 * Operator console layout — the auth gate for every panel page.
 *
 * It lives in the `(panel)` route group so that `/admin/login` (a sibling
 * outside this group) is NOT wrapped by it. Otherwise the login page would be
 * redirected back to itself forever.
 *
 * `requireAdminPage()` performs the authoritative check (cookie -> DB) and
 * redirects to /admin/login on failure.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AdminPanelLayout({
  children,
}: LayoutProps<"/admin">) {
  const admin = await requireAdminPage();

  return (
    <ToastProvider>
      <AdminShell username={admin.username}>{children}</AdminShell>
    </ToastProvider>
  );
}
