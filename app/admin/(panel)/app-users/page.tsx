import type { Metadata } from "next";
import { KeyRound } from "lucide-react";

import { AdminTablePage } from "@/components/admin/admin-table-page";
import { UserStatusBadge } from "@/components/ui";
import { requireAdminPage } from "@/lib/authorization";
import { listAllAppUsers } from "@/lib/admin-data";
import { paginationSchema } from "@/lib/validation";
import { formatDate, formatRelative } from "@/lib/cn";

export const metadata: Metadata = { title: "Application users" };

const FILTERS = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "banned", label: "Banned" },
  { value: "expired", label: "Expired" },
] as const;

/**
 * Every end-user licence across every tenant, with its owning application.
 * This is the customer data the platform operator is responsible for.
 */
export default async function AdminAppUsersPage({
  searchParams,
}: PageProps<"/admin/app-users">) {
  await requireAdminPage();
  const query = await searchParams;
  const options = paginationSchema.parse({
    page: query.page,
    limit: query.limit,
    search: typeof query.search === "string" ? query.search : undefined,
  });
  const status = typeof query.status === "string" ? query.status : undefined;

  const { users, total } = await listAllAppUsers({ ...options, status });

  const filterHref = (value: string) => {
    const params = new URLSearchParams();
    if (options.search) params.set("search", options.search);
    if (value) params.set("status", value);
    const qs = params.toString();
    return qs ? `?${qs}` : "?";
  };

  return (
    <AdminTablePage
      title="Application users"
      description="All end-user licences across all applications."
      total={total}
      page={options.page}
      limit={options.limit}
      search={options.search}
      searchPlaceholder="Search username"
      columns={["Username", "Application", "Status", "Expires", "Devices", "Last login"]}
      emptyTitle="No application users"
      emptyDescription="Licences issued by customers will appear here."
      emptyIcon={KeyRound}
      extraParams={{ status }}
      header={
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((filter) => (
            <a
              key={filter.value}
              href={filterHref(filter.value)}
              className={`btn btn-sm ${(status ?? "") === filter.value ? "btn-primary" : "btn-secondary"}`}
            >
              {filter.label}
            </a>
          ))}
        </div>
      }
      rows={users.map((user) => (
        <tr key={user.id} className="transition-colors hover:bg-surface-850/50">
          <td className="table-cell font-medium">{user.username}</td>
          <td className="table-cell text-ink-muted">{user.application.name}</td>
          <td className="table-cell">
            <UserStatusBadge
              isBanned={user.isBanned}
              isExpired={user.isExpired}
              lifetime={user.expiresAt === null}
            />
          </td>
          <td className="table-cell text-ink-muted">
            {user.expiresAt ? formatDate(user.expiresAt) : "Lifetime"}
          </td>
          <td className="table-cell tnum text-ink-muted">{user.maxDevices}</td>
          <td className="table-cell text-ink-muted">
            {user.lastLoginAt ? formatRelative(user.lastLoginAt) : "Never"}
          </td>
        </tr>
      ))}
    />
  );
}
