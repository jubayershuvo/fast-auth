import type { Metadata } from "next";

import { DashboardShell } from "@/components/dashboard/shell";
import { ToastProvider } from "@/components/ui/toast";
import { requireDashboardUserPage } from "@/lib/authorization";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * Dashboard layout — the single auth gate for every `/dashboard/*` page.
 *
 * `requireDashboardUserPage()` performs the REAL check (cookie -> DB lookup) and
 * redirects to /login on failure. Individual pages call the data services which
 * re-verify ownership, so authorisation is never assumed from having rendered
 * this layout.
 */
export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const user = await requireDashboardUserPage();

  return (
    <ToastProvider>
      <DashboardShell username={user.username} email={user.email}>
        {children}
      </DashboardShell>
    </ToastProvider>
  );
}
