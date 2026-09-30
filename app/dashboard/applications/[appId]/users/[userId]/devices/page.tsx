import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Fingerprint } from "lucide-react";

import { EmptyState } from "@/components/ui";
import { TableScroll } from "@/components/ui/table-scroll";
import { DeviceDeleteButton, DeviceEditButton } from "@/components/dashboard/device-actions";
import { SearchFilter } from "@/components/dashboard/search-filter";
import { requireApplicationOwnerPage } from "@/lib/authorization";
import { listDevices } from "@/lib/device";
import { getAppUser } from "@/lib/app-user";
import { paginationSchema } from "@/lib/validation";
import { formatRelative } from "@/lib/cn";

export const metadata: Metadata = { title: "User devices" };

/**
 * Devices registered by ONE application user.
 *
 * Devices are a per-user licensing concept: each user has a seat budget
 * (`maxDevices`) and only their own devices appear here. The app-wide devices
 * tab is the cross-user view; this page is where a single user's seats are
 * managed, which is why both rename and remove live here rather than only on
 * the global list.
 */
export default async function AppUserDevicesPage({
  params,
  searchParams,
}: PageProps<"/dashboard/applications/[appId]/users/[userId]/devices">) {
  const { appId, userId } = await params;
  const query = await searchParams;

  await requireApplicationOwnerPage(appId);
  // 404s if the user is not in THIS application, so a wrong appId/userId pair
  // cannot be used to probe another tenant's user.
  const user = await getAppUser(appId, userId);

  const options = paginationSchema.parse({
    page: query.page,
    limit: query.limit,
    search: typeof query.search === "string" ? query.search : undefined,
  });
  const { devices, total } = await listDevices(appId, { ...options, userId });
  const search = typeof query.search === "string" ? query.search : undefined;

  const seatsUsed = total;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/dashboard/applications/${appId}/users/${userId}`}
            className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to {user.username}
          </Link>
          <h1 className="mt-1 text-lg font-semibold tracking-tight text-ink">
            Devices for {user.username}
          </h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {seatsUsed} of {user.maxDevices} seat{user.maxDevices === 1 ? "" : "s"} used
          </p>
        </div>
        <SearchFilter
          action={`/dashboard/applications/${appId}/users/${userId}/devices`}
          search={search}
          placeholder="Search this user's devices…"
          className="w-full sm:w-auto sm:min-w-[18rem]"
        />
      </div>

      {devices.length === 0 ? (
        <div className="card">
          {search ? (
            <EmptyState
              title="No devices match your search"
              description={`Nothing registered to ${user.username} matches “${search}”.`}
              icon={Fingerprint}
            />
          ) : (
            <EmptyState
              title="No devices yet"
              description={`Devices appear here the first time ${user.username} logs in. Each one uses a seat.`}
              icon={Fingerprint}
            />
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <TableScroll label={`Devices for ${user.username}`}>
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-line bg-surface-850">
                <tr>
                  <th className="table-head">Device</th>
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
                    <td className="table-cell max-w-[240px]">
                      <p className="truncate text-[13px] text-ink">
                        {device.deviceName || "Unnamed device"}
                      </p>
                      <p className="truncate font-mono text-[11px] text-ink-subtle">
                        {device.deviceId}
                      </p>
                    </td>
                    <td className="table-cell text-ink-muted">{device.platform ?? "—"}</td>
                    <td className="table-cell text-ink-muted">{formatRelative(device.firstSeenAt)}</td>
                    <td className="table-cell text-ink-muted">{formatRelative(device.lastSeenAt)}</td>
                    <td className="table-cell font-mono text-[12px] text-ink-muted">
                      {device.lastIp ?? "—"}
                    </td>
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
