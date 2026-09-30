import type { Metadata } from "next";
import { Activity } from "lucide-react";

import { AdminTablePage } from "@/components/admin/admin-table-page";
import { Badge } from "@/components/ui";
import { requireAdminPage } from "@/lib/authorization";
import { listAllAppSessions } from "@/lib/admin-data";
import { paginationSchema } from "@/lib/validation";
import { formatDateTime } from "@/lib/cn";

export const metadata: Metadata = { title: "Sessions" };

/** Every end-user session issued across the platform. */
export default async function AdminSessionsPage({
  searchParams,
}: PageProps<"/admin/sessions">) {
  await requireAdminPage();
  const query = await searchParams;
  const options = paginationSchema.parse({ page: query.page, limit: query.limit });

  const { sessions, total } = await listAllAppSessions(options);

  return (
    <AdminTablePage
      title="Sessions"
      description="All end-user sessions across the platform."
      total={total}
      page={options.page}
      limit={options.limit}
      searchPlaceholder="Search"
      columns={["Status", "User", "Application", "Device", "Created", "Expires", "IP"]}
      emptyTitle="No sessions issued"
      emptyDescription="Sessions are created when an end user logs in."
      emptyIcon={Activity}
      rows={sessions.map((session) => (
        <tr key={session.id} className="transition-colors hover:bg-surface-850/50">
          <td className="table-cell">
            {session.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Ended</Badge>}
          </td>
          <td className="table-cell text-ink-muted">{session.user}</td>
          <td className="table-cell text-ink-muted">{session.application}</td>
          <td className="table-cell max-w-[160px] truncate font-mono text-[12px]">
            {session.deviceId}
          </td>
          <td className="table-cell whitespace-nowrap text-ink-muted">
            {formatDateTime(session.createdAt)}
          </td>
          <td className="table-cell whitespace-nowrap text-ink-muted">
            {formatDateTime(session.expiresAt)}
          </td>
          <td className="table-cell font-mono text-[12px] text-ink-muted">{session.ip ?? "—"}</td>
        </tr>
      ))}
    />
  );
}
