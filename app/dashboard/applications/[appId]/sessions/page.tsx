import type { Metadata } from "next";
import { KeyRound } from "lucide-react";

import { EmptyState, Badge } from "@/components/ui";
import { TableScroll } from "@/components/ui/table-scroll";
import { SearchFilter } from "@/components/dashboard/search-filter";
import { requireApplicationOwnerPage } from "@/lib/authorization";
import { listAppSessions } from "@/lib/app-session";
import { paginationSchema } from "@/lib/validation";
import { formatDateTime } from "@/lib/cn";

export const metadata: Metadata = { title: "Sessions" };

/** Active and revoked end-user sessions for this application. */
export default async function SessionsPage({
  params,
  searchParams,
}: PageProps<"/dashboard/applications/[appId]/sessions">) {
  const { appId } = await params;
  const query = await searchParams;
  const options = paginationSchema.parse({
    page: query.page,
    limit: query.limit,
    search: typeof query.search === "string" ? query.search : undefined,
  });

  await requireApplicationOwnerPage(appId);
  const { sessions, total } = await listAppSessions(appId, options);
  const search = typeof query.search === "string" ? query.search : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-ink-muted">
          {total} session{total === 1 ? "" : "s"} issued
          {search ? ` matching “${search}”` : ""}
        </p>
        <SearchFilter
          action={`/dashboard/applications/${appId}/sessions`}
          search={search}
          placeholder="Search device, IP or agent…"
          className="w-full sm:w-auto sm:min-w-[18rem]"
        />
      </div>

      {sessions.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No sessions yet"
            description="Sessions are created when an end user logs in through the API."
            icon={KeyRound}
          />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <TableScroll label="Application sessions">
          <table className="w-full min-w-[720px]">
              <thead className="border-b border-line bg-surface-850">
                <tr>
                  <th className="table-head">Status</th>
                  <th className="table-head">Device</th>
                  <th className="table-head">Created</th>
                  <th className="table-head">Expires</th>
                  <th className="table-head">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sessions.map((session) => (
                  <tr key={session.id} className="transition-colors hover:bg-surface-850/50">
                    <td className="table-cell">
                      {session.isActive ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge tone="neutral">Ended</Badge>
                      )}
                    </td>
                    <td className="table-cell max-w-[200px] truncate font-mono text-[12px]">
                      {session.deviceId}
                    </td>
                    <td className="table-cell text-ink-muted">{formatDateTime(session.createdAt)}</td>
                    <td className="table-cell text-ink-muted">{formatDateTime(session.expiresAt)}</td>
                    <td className="table-cell font-mono text-[12px] text-ink-muted">{session.ip ?? "—"}</td>
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
