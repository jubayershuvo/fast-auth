import type { Metadata } from "next";

import { PageHeader } from "@/components/ui";
import { PlanUsageBanner } from "@/components/dashboard/plan-usage-banner";
import { ApplicationManager } from "@/components/dashboard/application-manager";
import { requireDashboardUserPage } from "@/lib/authorization";
import { listApplications } from "@/lib/application";
import { getPlanUsage } from "@/lib/plans";

export const metadata: Metadata = { title: "Applications" };

/** List + manage the signed-in customer's applications. */
export default async function ApplicationsPage() {
  // The ownerId comes from the session, never from the URL.
  const user = await requireDashboardUserPage();
  const [applications, usage] = await Promise.all([
    listApplications(user.id),
    getPlanUsage(user.id),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-5 py-7 sm:px-7 lg:px-9">
      <PageHeader
        title="Applications"
        description="Each application is an isolated tenant with its own users, devices and logs."
      />

      <div className="mt-5">
        <PlanUsageBanner usage={usage} />
      </div>

      {/*
        Always mounted, including when the list is empty. Previously the empty
        branch replaced the whole manager, so a brand-new account had no way to
        create its first application — the empty state told them to create one
        and offered nothing to click.
      */}
      <div className="mt-4">
        <ApplicationManager
          applications={applications}
          canCreate={usage.canCreate}
          planLabel={usage.plan.label}
        />
      </div>
    </div>
  );
}
