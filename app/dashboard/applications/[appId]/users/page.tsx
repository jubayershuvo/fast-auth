import type { Metadata } from "next";

import { AppUserManager } from "@/components/dashboard/app-user-manager";
import { requireApplicationOwnerPage } from "@/lib/authorization";
import { listAppUsers } from "@/lib/app-user";
import { paginationSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Users" };

/** Paginated application-user list with lifecycle actions. */
export default async function AppUsersPage({
  params,
  searchParams,
}: PageProps<"/dashboard/applications/[appId]/users">) {
  const { appId } = await params;
  const query = await searchParams;
  const options = paginationSchema.parse({
    page: query.page,
    limit: query.limit,
    search: typeof query.search === "string" ? query.search : undefined,
  });

  // Ownership check before any user data is read.
  await requireApplicationOwnerPage(appId);
  const result = await listAppUsers(appId, options);

  return (
    <div>
      {/*
        Always mounted, including when the list is empty. The empty state used
        to REPLACE this manager, so a brand-new application had no way to add
        its first end user — the page said to add one and offered no control.
      */}
      <AppUserManager
        appId={appId}
        users={result.users}
        total={result.total}
        search={options.search}
      />
    </div>
  );
}
