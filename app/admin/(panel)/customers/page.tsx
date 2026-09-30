import type { Metadata } from "next";
import { Users } from "lucide-react";

import { AdminTablePage } from "@/components/admin/admin-table-page";
import { PlanSelector } from "@/components/admin/plan-selector";
import { requireAdminPage } from "@/lib/authorization";
import { listCustomers } from "@/lib/admin-data";
import { listPlans } from "@/lib/plans";
import { paginationSchema } from "@/lib/validation";
import { formatDate, formatRelative } from "@/lib/cn";

export const metadata: Metadata = { title: "Customers" };

/** Every dashboard account, with the subscription plan the operator assigns. */
export default async function AdminCustomersPage({
  searchParams,
}: PageProps<"/admin/customers">) {
  await requireAdminPage();
  const query = await searchParams;
  const options = paginationSchema.parse({
    page: query.page,
    limit: query.limit,
    search: typeof query.search === "string" ? query.search : undefined,
  });

  const { customers, total } = await listCustomers(options);
  const plans = listPlans();

  return (
    <AdminTablePage
      title="Customers"
      description="Every dashboard account, with its subscription plan."
      total={total}
      page={options.page}
      limit={options.limit}
      search={options.search}
      searchPlaceholder="Search email or username"
      columns={["Email", "Plan", "Applications", "Joined", "Last sign-in"]}
      emptyTitle="No customers yet"
      emptyDescription="Registered dashboard accounts will appear here."
      emptyIcon={Users}
      rows={customers.map((customer) => {
        const plan = plans.find((item) => item.id === customer.plan);
        const cap = plan?.appLimit;
        const overLimit = cap !== null && cap !== undefined && customer.applicationCount > cap;
        return (
          <tr key={customer.id} className="transition-colors hover:bg-surface-850/50">
            <td className="table-cell">
              <p className="font-medium">{customer.email}</p>
              <p className="text-[11px] text-ink-subtle">@{customer.username}</p>
            </td>
            <td className="table-cell">
              <PlanSelector customer={customer} />
              {overLimit ? (
                <p className="mt-1 text-[11px] text-danger-400">
                  Over limit — {customer.applicationCount}/{cap}
                </p>
              ) : null}
            </td>
            <td className="table-cell tnum text-ink-muted">{customer.applicationCount}</td>
            <td className="table-cell text-ink-muted">{formatDate(customer.createdAt)}</td>
            <td className="table-cell text-ink-muted">
              {customer.lastLoginAt ? formatRelative(customer.lastLoginAt) : "Never"}
            </td>
          </tr>
        );
      })}
    />
  );
}
