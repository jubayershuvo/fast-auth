import type { Metadata } from "next";
import { ScrollText } from "lucide-react";

import { EmptyState, Badge } from "@/components/ui";
import { TableScroll } from "@/components/ui/table-scroll";
import { requireApplicationOwnerPage } from "@/lib/authorization";
import { connectToDatabase } from "@/lib/mongodb";
import { toObjectId } from "@/lib/authorization";
import { AuthLogModel, buildAuthLogFilter, type AuthActionValue } from "@/models/AuthLog";
import { SearchFilter } from "@/components/dashboard/search-filter";
import { paginationSchema } from "@/lib/validation";
import { formatDateTime } from "@/lib/cn";

export const metadata: Metadata = { title: "Logs" };

const TONE: Record<string, "success" | "danger" | "warn" | "info" | "neutral"> = {
  LOGIN_SUCCESS: "success",
  LOGIN_FAILED: "danger",
  ACCOUNT_BANNED: "danger",
  ACCOUNT_UNBANNED: "success",
  ACCOUNT_EXPIRED: "warn",
  DEVICE_ADDED: "info",
  DEVICE_REMOVED: "neutral",
  SESSION_CREATED: "info",
  SESSION_REVOKED: "neutral",
  SESSION_RENEWED: "info",
  LOGOUT: "neutral",
  TOKEN_VALIDATED: "neutral",
  USER_CREATED: "info",
  USER_UPDATED: "neutral",
  USER_DELETED: "danger",
  PASSWORD_RESET: "warn",
};

/** The authentication audit trail, newest first. */
export default async function LogsPage({
  params,
  searchParams,
}: PageProps<"/dashboard/applications/[appId]/logs">) {
  const { appId } = await params;
  const query = await searchParams;
  const options = paginationSchema.parse({ page: query.page, limit: query.limit });
  const actionFilter =
    typeof query.action === "string" && query.action.length > 0
      ? (query.action as AuthActionValue)
      : undefined;

  await requireApplicationOwnerPage(appId);
  await connectToDatabase();

  const objectId = toObjectId(appId, "application id");
  const search = typeof query.search === "string" ? query.search : undefined;
  const filter = buildAuthLogFilter(objectId, { action: actionFilter, search });

  const skip = (options.page - 1) * options.limit;
  const [logs, total] = await Promise.all([
    AuthLogModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(options.limit).lean(),
    AuthLogModel.countDocuments(filter),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-ink-muted">
          {total} event{total === 1 ? "" : "s"} recorded
          {search ? ` matching “${search}”` : ""}
        </p>
        <SearchFilter
          action={`/dashboard/applications/${appId}/logs`}
          search={search}
          placeholder="Search user, device or IP…"
          // Keep the action filter when searching, so refining a filtered
          // trail does not silently drop the action the owner picked.
          hidden={{ action: actionFilter }}
          className="w-full sm:w-auto sm:min-w-[18rem]"
        />
      </div>

      {logs.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No events yet"
            description="Every login, ban, device change and revocation is recorded here."
            icon={ScrollText}
          />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <TableScroll label="Audit log">
          <table className="w-full min-w-[860px]">
              <thead className="border-b border-line bg-surface-850">
                <tr>
                  <th className="table-head">Time</th>
                  <th className="table-head">Username</th>
                  <th className="table-head">Action</th>
                  <th className="table-head">Result</th>
                  <th className="table-head">IP</th>
                  <th className="table-head">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {logs.map((log) => (
                  <tr key={log._id.toString()} className="transition-colors hover:bg-surface-850/50">
                    <td className="table-cell whitespace-nowrap text-ink-muted">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="table-cell font-medium">{log.username ?? "—"}</td>
                    <td className="table-cell">
                      <Badge tone={TONE[log.action] ?? "neutral"}>
                        {log.action.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="table-cell">
                      {log.success ? (
                        <Badge tone="success">Success</Badge>
                      ) : (
                        <Badge tone="danger">Failure</Badge>
                      )}
                    </td>
                    <td className="table-cell font-mono text-[12px] text-ink-muted">{log.ip ?? "—"}</td>
                    <td className="table-cell max-w-[200px] truncate text-[12px] text-ink-subtle">
                      {log.reason ?? "—"}
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
