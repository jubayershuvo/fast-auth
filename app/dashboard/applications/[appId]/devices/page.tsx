import type { Metadata } from "next";
import Link from "next/link";
import { Fingerprint } from "lucide-react";

import { EmptyState } from "@/components/ui";
import { TableScroll } from "@/components/ui/table-scroll";
import { DeviceDeleteButton, DeviceEditButton } from "@/components/dashboard/device-actions";
import { SearchFilter } from "@/components/dashboard/search-filter";
import { requireApplicationOwnerPage } from "@/lib/authorization";
import { listDevices } from "@/lib/device";
import { paginationSchema } from "@/lib/validation";
import { formatRelative } from "@/lib/cn";

export const metadata: Metadata = { title: "Devices" };

/**
 * Registered devices for this application.
 *
 * Note the model: `deviceId` is a client-supplied identifier, so this is a
 * seat-control view, not hardware attestation.
 */
export default async function DevicesPage({
  params,
  searchParams,
}: PageProps<"/dashboard/applications/[appId]/devices">) {
  const { appId } = await params;
  const query = await searchParams;
  const options = paginationSchema.parse({
    page: query.page,
    limit: query.limit,
    search: typeof query.search === "string" ? query.search : undefined,
  });

  await requireApplicationOwnerPage(appId);
  const { devices, total } = await listDevices(appId, options);
  const search = typeof query.search === "string" ? query.search : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-ink-muted">
          {total} device{total === 1 ? "" : "s"} registered
          {search ? ` matching “${search}”` : ""}
        </p>
        <SearchFilter
          action={`/dashboard/applications/${appId}/devices`}
          search={search}
          placeholder="Search device, platform or IP…"
          className="w-full sm:w-auto sm:min-w-[18rem]"
        />
      </div>

      {devices.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No devices yet"
            description="Devices appear here the first time an end user logs in."
            icon={Fingerprint}
          />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <TableScroll label="Registered devices">
          <table className="w-full min-w-[720px]">
              <thead className="border-b border-line bg-surface-850">
                <tr>
                  <th className="table-head">Device</th>
                  <th className="table-head">User</th>
                  <th className="table-head">Platform</th>
                  <th className="table-head">First seen</th>
                  <th className="table-head">Last seen</th>
                  <th className="table-head">IP</th>
                  <th className="table-head text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {devices.map((device) => (
                  <tr key={device.id} className="transition-colors hover:bg-surface-850/50">
                    <td className="table-cell max-w-[220px]">
                      <p className="truncate text-[13px] text-ink">
                        {/* `||` not `??`: rows written before empty names were
                            normalised can still hold "", and `??` would leave a
                            blank cell instead of the placeholder. */}
                        {device.deviceName || "Unnamed device"}
                      </p>
                      <p className="truncate font-mono text-[11px] text-ink-subtle">
                        {device.deviceId}
                      </p>
                    </td>
                    <td className="table-cell">
                      {/* Name first, then the link: the username is the information,
                          "Manage" is the affordance. A link alone told the owner
                          nothing about whose seat the row was consuming. */}
                      <Link
                        href={`/dashboard/applications/${appId}/users/${device.userId}/devices`}
                        className="text-[13px] font-medium text-accent hover:underline"
                      >
                        {device.username ?? "Unknown user"}
                      </Link>
                    </td>
                    <td className="table-cell text-ink-muted">{device.platform ?? "—"}</td>
                    <td className="table-cell text-ink-muted">{formatRelative(device.firstSeenAt)}</td>
                    <td className="table-cell text-ink-muted">{formatRelative(device.lastSeenAt)}</td>
                    <td className="table-cell font-mono text-[12px] text-ink-muted">{device.lastIp ?? "—"}</td>
                    <td className="table-cell">
                      <div className="flex justify-end gap-2">
                        <DeviceEditButton appId={appId} device={device} />
                        <DeviceDeleteButton appId={appId} device={device} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}
    </div>
  );
}
