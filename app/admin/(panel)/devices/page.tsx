import type { Metadata } from "next";
import { Fingerprint } from "lucide-react";

import { AdminTablePage } from "@/components/admin/admin-table-page";
import { requireAdminPage } from "@/lib/authorization";
import { listAllDevices } from "@/lib/admin-data";
import { paginationSchema } from "@/lib/validation";
import { formatRelative } from "@/lib/cn";

export const metadata: Metadata = { title: "Devices" };

/** Every device registered by any end user, across every tenant. */
export default async function AdminDevicesPage({
  searchParams,
}: PageProps<"/admin/devices">) {
  await requireAdminPage();
  const query = await searchParams;
  const options = paginationSchema.parse({ page: query.page, limit: query.limit });

  const { devices, total } = await listAllDevices(options);

  return (
    <AdminTablePage
      title="Devices"
      description="All registered devices across the platform."
      total={total}
      page={options.page}
      limit={options.limit}
      searchPlaceholder="Search"
      columns={["Device ID", "User", "Application", "Platform", "Last seen", "IP"]}
      emptyTitle="No devices registered"
      emptyDescription="Devices appear here when an end user logs in."
      emptyIcon={Fingerprint}
      rows={devices.map((device) => (
        <tr key={device.id} className="transition-colors hover:bg-surface-850/50">
          <td className="table-cell max-w-[200px] truncate font-mono text-[12px]">
            {device.deviceId}
          </td>
          <td className="table-cell text-ink-muted">{device.user}</td>
          <td className="table-cell text-ink-muted">{device.application}</td>
          <td className="table-cell text-ink-muted">{device.platform ?? "—"}</td>
          <td className="table-cell text-ink-muted">
            {formatRelative(device.lastSeenAt)}
          </td>
          <td className="table-cell font-mono text-[12px] text-ink-muted">
            {device.lastIp ?? "—"}
          </td>
        </tr>
      ))}
    />
  );
}
