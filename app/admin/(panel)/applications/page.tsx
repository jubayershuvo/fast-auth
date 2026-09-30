import type { Metadata } from "next";
import { Boxes } from "lucide-react";

import { AdminTablePage } from "@/components/admin/admin-table-page";
import { requireAdminPage } from "@/lib/authorization";
import { listAllApplications } from "@/lib/admin-data";
import { paginationSchema } from "@/lib/validation";
import { formatDate } from "@/lib/cn";

export const metadata: Metadata = { title: "Applications" };

/**
 * Every application across every tenant, with its owner.
 *
 * Note what is NOT here: the app secret. Only the public appId and a
 * fingerprint of the secret exist in this view.
 */
export default async function AdminApplicationsPage({
  searchParams,
}: PageProps<"/admin/applications">) {
  await requireAdminPage();
  const query = await searchParams;
  const options = paginationSchema.parse({
    page: query.page,
    limit: query.limit,
    search: typeof query.search === "string" ? query.search : undefined,
  });

  const { applications, total } = await listAllApplications(options);

  return (
    <AdminTablePage
      title="Applications"
      description="All customer applications, with the owning account."
      total={total}
      page={options.page}
      limit={options.limit}
      search={options.search}
      searchPlaceholder="Search name or app id"
      columns={["Name", "App ID", "Owner", "Users", "Created"]}
      emptyTitle="No applications yet"
      emptyDescription="Applications created by customers will appear here."
      emptyIcon={Boxes}
      rows={applications.map((app) => (
        <tr key={app.id} className="transition-colors hover:bg-surface-850/50">
          <td className="table-cell font-medium">{app.name}</td>
          <td className="table-cell font-mono text-[12px] text-ink-muted">{app.appId}</td>
          <td className="table-cell text-ink-muted">
            {app.owner.email}
            <span className="ml-2 text-[11px] text-ink-subtle">@{app.owner.username}</span>
          </td>
          <td className="table-cell tnum text-ink-muted">{app.userCount}</td>
          <td className="table-cell text-ink-muted">{formatDate(app.createdAt)}</td>
        </tr>
      ))}
    />
  );
}
