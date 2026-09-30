import type { Metadata } from "next";
import { ScrollText } from "lucide-react";

import { AdminTablePage } from "@/components/admin/admin-table-page";
import { Badge } from "@/components/ui";
import { requireAdminPage } from "@/lib/authorization";
import { listAllAuthLogs } from "@/lib/admin-data";
import { paginationSchema } from "@/lib/validation";
import { formatDateTime } from "@/lib/cn";

export const metadata: Metadata = { title: "Audit log" };

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

const ACTIONS = [
  "",
  "LOGIN_SUCCESS",
  "LOGIN_FAILED",
  "ACCOUNT_BANNED",
  "ACCOUNT_EXPIRED",
  "SESSION_REVOKED",
  "DEVICE_ADDED",
] as const;

/** The complete platform-wide authentication audit trail. */
export default async function AdminLogsPage({
  searchParams,
}: PageProps<"/admin/logs">) {
  await requireAdminPage();
  const query = await searchParams;
  const options = paginationSchema.parse({ page: query.page, limit: query.limit });
  const action = typeof query.action === "string" && query.action ? query.action : undefined;

  const { logs, total } = await listAllAuthLogs({ ...options, action });

  const filterHref = (value: string) => {
    const params = new URLSearchParams();
    if (value) params.set("action", value);
    const qs = params.toString();
    return qs ? `?${qs}` : "?";
  };

  return (
    <AdminTablePage
      title="Audit log"
      description="Every authentication event across all tenants."
      total={total}
      page={options.page}
      limit={options.limit}
      searchPlaceholder="Search"
      columns={["Time", "Username", "Action", "Result", "IP", "Reason"]}
      emptyTitle="No events recorded"
      emptyDescription="Authentication events will appear here."
      emptyIcon={ScrollText}
      extraParams={{ action }}
      header={
        <div className="flex flex-wrap gap-1.5">
          {ACTIONS.map((value) => (
            <a
              key={value || "all"}
              href={filterHref(value)}
              className={`btn btn-sm ${(action ?? "") === value ? "btn-primary" : "btn-secondary"}`}
            >
              {value ? value.replace(/_/g, " ").toLowerCase() : "all"}
            </a>
          ))}
        </div>
      }
      rows={logs.map((log) => (
        <tr key={log.id} className="transition-colors hover:bg-surface-850/50">
          <td className="table-cell whitespace-nowrap text-ink-muted">
            {formatDateTime(log.createdAt)}
          </td>
          <td className="table-cell font-medium">{log.username ?? "—"}</td>
          <td className="table-cell">
            <Badge tone={TONE[log.action] ?? "neutral"}>{log.action.replace(/_/g, " ")}</Badge>
          </td>
          <td className="table-cell">
            {log.success ? <Badge tone="success">Success</Badge> : <Badge tone="danger">Failure</Badge>}
          </td>
          <td className="table-cell font-mono text-[12px] text-ink-muted">{log.ip ?? "—"}</td>
          <td className="table-cell max-w-[200px] truncate text-[12px] text-ink-subtle">
            {log.reason ?? "—"}
          </td>
        </tr>
      ))}
    />
  );
}
