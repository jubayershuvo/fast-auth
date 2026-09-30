"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, ShieldBan, CalendarPlus, Trash2, Undo2, Users } from "lucide-react";

import { apiFetch, ApiClientError } from "@/lib/api-client";
import { Alert, Spinner, type AlertMessage } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui";
import { TableScroll } from "@/components/ui/table-scroll";
import { useToast } from "@/components/ui/toast";
import { SearchFilter } from "@/components/dashboard/search-filter";
import type { PublicAppUser } from "@/models/AppUser";
import { ActionDialog, CreateUserModal, inDays } from "./user-dialogs";
import { BanUserDialog, ExtendUserDialog, type UserAction } from "./user-action-dialogs";

/**
 * Application-user table with the common lifecycle actions.
 *
 * Deeper management (password reset, device limit, live devices and sessions)
 * lives on each user's detail page.
 */
export function AppUserManager({
  appId,
  users,
  total = users.length,
  search,
}: {
  appId: string;
  users: PublicAppUser[];
  /** Total matching the query, which may exceed `users` on a later page. */
  total?: number;
  /** Active search term, used only to word the empty state. */
  search?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [creating, setCreating] = useState(false);
  const [action, setAction] = useState<UserAction | null>(null);
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<AlertMessage | null>(null);

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [maxDevices, setMaxDevices] = useState(1);
  const [expiry, setExpiry] = useState<"lifetime" | number>(30);

  const [banReason, setBanReason] = useState("");
  const [banRevoke, setBanRevoke] = useState(true);
  const [extendDays, setExtendDays] = useState<number>(30);
  const [extendFrom, setExtendFrom] = useState<"now" | "previous">("now");

  const base = `/api/dashboard/applications/${appId}/users`;

  function close() {
    setAlert(null);
    setPending(false);
  }

  function open(next: UserAction) {
    close();
    setAction(next);
  }

  async function run(call: () => Promise<unknown>, successTitle: string) {
    setPending(true);
    setAlert(null);
    try {
      await call();
      toast({ tone: "success", title: successTitle });
      close();
      setAction(null);
      router.refresh();
    } catch (error) {
      setAlert({
        variant: "error",
        message: error instanceof ApiClientError ? error.message : "The request failed.",
        fields: error instanceof ApiClientError ? error.details : undefined,
      });
      setPending(false);
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setAlert(null);
    try {
      await apiFetch(base, {
        method: "POST",
        body: {
          name,
          username,
          password,
          maxDevices,
          expiresAt: expiry === "lifetime" ? "lifetime" : inDays(expiry),
        },
      });
      toast({ tone: "success", title: `User ${username} created` });
      setCreating(false);
      setName("");
      setUsername("");
      setPassword("");
      close();
      router.refresh();
    } catch (error) {
      setAlert({
        variant: "error",
        message: error instanceof ApiClientError ? error.message : "Could not create the user.",
        fields: error instanceof ApiClientError ? error.details : undefined,
      });
      setPending(false);
    }
  }

  // Hoisted so the populated header and the empty state share one button.
  // Defining it per branch previously left the empty state with no way to
  // create the very first end user.
  const createButton = (
    <button type="button" onClick={() => { setCreating(true); close(); }} className="btn btn-md btn-primary">
      <Plus className="h-4 w-4" />
      New user
    </button>
  );

  return (
    <>
      {users.length === 0 ? (
        <div className="card">
          <EmptyState
            title={search ? "No users match your search" : "No users yet"}
            description={
              search
                ? "Try a different username."
                : "Add your first end user to start issuing credentials."
            }
            icon={Users}
            action={createButton}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {createButton}
              <p className="text-[13px] text-ink-muted">
                {total} user{total === 1 ? "" : "s"}
                {search ? ` matching “${search}”` : ""}
              </p>
            </div>
            <SearchFilter
              action={`/dashboard/applications/${appId}/users`}
              search={search}
              placeholder="Search username…"
              className="w-full sm:w-auto sm:min-w-[16rem]"
            />
          </div>

          <div className="card overflow-hidden">
            <TableScroll label="End users">
          <table className="w-full min-w-[860px]">
            <thead className="border-b border-line bg-surface-850">
              <tr>
                <th className="table-head">Username</th>
                <th className="table-head">Status</th>
                <th className="table-head">Expires</th>
                <th className="table-head">Devices</th>
                <th className="table-head">Last login</th>
                <th className="table-head text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((user) => (
                <tr key={user.id} className="transition-colors hover:bg-surface-850/50">
                  <td className="table-cell font-medium">
                    {/* Name above, login handle below: the owner recognises people
                        by name but authenticates them by username, and both are
                        needed. */}
                    <Link
                      href={`/dashboard/applications/${appId}/users/${user.id}`}
                      className="block hover:text-brand-300"
                    >
                      <span className="block truncate">{user.name}</span>
                      <span className="block truncate font-mono text-[11px] font-normal text-ink-subtle">
                        {user.username}
                      </span>
                    </Link>
                  </td>
                  <td className="table-cell">
                    {user.isBanned ? (
                      <span className="badge border border-danger-500/30 bg-danger-900/50 text-danger-400">Banned</span>
                    ) : user.isExpired ? (
                      <span className="badge border border-warn-500/30 bg-warn-900/50 text-warn-400">Expired</span>
                    ) : (
                      <span className="badge border border-success-500/30 bg-success-900/50 text-success-400">Active</span>
                    )}
                  </td>
                  <td className="table-cell text-ink-muted">
                    {user.expiresAt === null
                      ? "Lifetime"
                      : new Date(user.expiresAt).toLocaleDateString("en-GB")}
                  </td>
                  <td className="table-cell tnum text-ink-muted">{user.maxDevices}</td>
                  <td className="table-cell text-ink-muted">
                    {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("en-GB") : "Never"}
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center justify-end gap-1">
                      {user.isBanned ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run(
                            () => apiFetch(`${base}/${user.id}/unban`, { method: "POST", body: {} }),
                            `${user.username} unbanned`,
                          )}
                          className="btn btn-sm btn-ghost"
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                          Unban
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setBanReason(""); open({ kind: "ban", user }); }}
                          className="btn btn-sm btn-ghost"
                        >
                          <ShieldBan className="h-3.5 w-3.5" />
                          Ban
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => open({ kind: "extend", user })}
                        className="btn btn-sm btn-ghost"
                      >
                        <CalendarPlus className="h-3.5 w-3.5" />
                        Extend
                      </button>
                      <button
                        type="button"
                        onClick={() => open({ kind: "delete", user })}
                        className="btn btn-sm btn-ghost text-danger-400"
                        aria-label={`Delete ${user.username}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
            </TableScroll>
          </div>
        </>
      )}

      <CreateUserModal
        open={creating}
        onClose={() => setCreating(false)}
        alert={alert}
        form={{
          username, password, maxDevices, expiry,
          name, setName, setUsername, setPassword, setMaxDevices, setExpiry, onSubmit: handleCreate,
        }}
        footer={
          <>
            <button type="button" onClick={() => setCreating(false)} className="btn btn-sm btn-ghost">Cancel</button>
            <button type="submit" form="create-user" disabled={pending} className="btn btn-sm btn-primary">
              {pending ? <Spinner /> : null} Create user
            </button>
          </>
        }
      />

      <BanUserDialog
        action={action}
        alert={alert}
        pending={pending}
        reason={banReason}
        revokeSessions={banRevoke}
        onReasonChange={setBanReason}
        onRevokeChange={setBanRevoke}
        onClose={() => setAction(null)}
        onConfirm={() => {
          if (action?.kind !== "ban") return;
          void run(
            () => apiFetch(`${base}/${action.user.id}/ban`, {
              method: "POST",
              body: { reason: banReason, revokeSessions: banRevoke },
            }),
            `${action.user.username} banned`,
          );
        }}
      />

      <ExtendUserDialog
        action={action}
        alert={alert}
        pending={pending}
        days={extendDays}
        from={extendFrom}
        onDaysChange={setExtendDays}
        onFromChange={setExtendFrom}
        onClose={() => setAction(null)}
        onConfirm={() => {
          if (action?.kind !== "extend") return;
          void run(
            () => apiFetch(`${base}/${action.user.id}/extend`, {
              method: "POST",
              body: { days: extendDays, from: extendFrom },
            }),
            "Expiry extended",
          );
        }}
      />

      {action?.kind === "delete" ? (
        <ActionDialog
          open
          onClose={() => setAction(null)}
          title={`Delete ${action.user.username}`}
          alert={alert}
          footer={
            <>
              <button type="button" onClick={() => setAction(null)} className="btn btn-sm btn-ghost">Cancel</button>
              <button
                type="button"
                disabled={pending}
                className="btn btn-sm btn-danger"
                onClick={() => run(
                  () => apiFetch(`${base}/${action.user.id}`, { method: "DELETE" }),
                  "User deleted",
                )}
              >
                {pending ? <Spinner /> : null} Delete permanently
              </button>
            </>
          }
        >
          <Alert variant="error">
            This removes <strong>{action.user.username}</strong> along with their devices and
            sessions. Authentication history is retained for auditing.
          </Alert>
        </ActionDialog>
      ) : null}
    </>
  );
}
