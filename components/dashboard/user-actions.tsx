"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint, LogOut, ShieldBan, ShieldCheck, Trash2, KeyRound, RotateCcw, Copy } from "lucide-react";

import { apiFetch, ApiClientError } from "@/lib/api-client";
import { Alert, Spinner } from "@/components/ui/alert";
import { useToast } from "@/components/ui/toast";

/**
 * Action bar for a single application user.
 * Every call is scoped by BOTH applicationId and userId on the server.
 */
export function UserActions({
  appId,
  userId,
  isBanned,
  devicesUsed,
  activeSessions,
}: {
  appId: string;
  userId: string;
  isBanned: boolean;
  devicesUsed: number;
  activeSessions: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Non-null while the one-time password reveal dialog is open. */
  const [newPassword, setNewPassword] = useState<string | null>(null);

  const base = `/api/dashboard/applications/${appId}/users/${userId}`;

  /**
   * Reset to a server-generated password and SHOW it.
   *
   * The password used to be generated here with Math.random() and sent up in a
   * PATCH. That was wrong twice over: Math.random() is a seeded, predictable
   * PRNG, and the owner was never shown the value, so "Reset password" locked
   * the end user out of their own account. The server now generates it with a
   * CSPRNG and returns the plaintext exactly once — so it has to be displayed,
   * or the same lock-out returns.
   */
  async function resetPassword() {
    setPending("password");
    setError(null);
    try {
      const result = await apiFetch<{ password: string; sessionsRevoked: number }>(
        `${base}/reset-password`,
        { method: "POST" },
      );

      setPending(null);
      setNewPassword(result.password);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not reset the password.");
      setPending(null);
    }
  }

  async function run(key: string, call: () => Promise<unknown>, title: string) {
    setPending(key);
    setError(null);
    try {
      await call();
      toast({ tone: "success", title });
      setPending(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "The request failed.");
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      {error ? <Alert variant="error" message={error} /> : null}

      <div className="flex flex-wrap gap-2">
        {isBanned ? (
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => run("unban", () => apiFetch(`${base}/unban`, { method: "POST", body: {} }), "User unbanned")}
            className="btn btn-sm btn-secondary"
          >
            {pending === "unban" ? <Spinner /> : <ShieldCheck className="h-3.5 w-3.5" />}
            Unban
          </button>
        ) : (
          <a href="#ban" className="btn btn-sm btn-secondary">
            <ShieldBan className="h-3.5 w-3.5" />
            Ban
          </a>
        )}

        <button
          type="button"
          disabled={pending !== null || devicesUsed === 0}
          onClick={() => run(
            "devices",
            () => apiFetch(`${base}/reset-devices`, { method: "POST" }),
            `Reset ${devicesUsed} device${devicesUsed === 1 ? "" : "s"}`,
          )}
          className="btn btn-sm btn-secondary"
        >
          {pending === "devices" ? <Spinner /> : <Fingerprint className="h-3.5 w-3.5" />}
          Reset devices ({devicesUsed})
        </button>

        <button
          type="button"
          disabled={pending !== null || activeSessions === 0}
          onClick={() => run(
            "sessions",
            () => apiFetch(`${base}/revoke-sessions`, { method: "POST", body: {} }),
            `Revoked ${activeSessions} session${activeSessions === 1 ? "" : "s"}`,
          )}
          className="btn btn-sm btn-secondary"
        >
          {pending === "sessions" ? <Spinner /> : <LogOut className="h-3.5 w-3.5" />}
          Revoke sessions ({activeSessions})
        </button>

        <button
          type="button"
          disabled={pending !== null}
          onClick={resetPassword}
          className="btn btn-sm btn-secondary"
        >
          {pending === "password" ? <Spinner /> : <RotateCcw className="h-3.5 w-3.5" />}
          Reset password
        </button>

        <button
          type="button"
          disabled={pending !== null}
          onClick={() => setConfirmDelete(true)}
          className="btn btn-sm btn-danger-soft"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      </div>

      {confirmDelete ? (
        <div className="rounded-lg border border-danger-500/30 bg-danger-900/30 p-3">
          <p className="text-[13px] text-ink">
            Delete this user, their devices and sessions? This cannot be undone.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => run("delete", () => apiFetch(base, { method: "DELETE" }), "User deleted")}
              className="btn btn-sm btn-danger"
            >
              {pending === "delete" ? <Spinner /> : <Trash2 className="h-3.5 w-3.5" />}
              Yes, delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="btn btn-sm btn-ghost"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {newPassword === null ? null : (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-password-title"
            className="w-full max-w-md rounded-lg border border-line bg-surface p-5 shadow-xl"
          >
            <h3 id="new-password-title" className="text-sm font-semibold text-ink">
              New password — copy it now
            </h3>
            <p className="mt-2 text-[13px] text-ink-muted">
              This is the only time it will be shown. Every live session was revoked,
              so hand it to the user directly.
            </p>
            <code className="mt-3 block break-all rounded-md border border-line bg-surface-850 px-3 py-2.5 font-mono text-[13px] text-ink">
              {newPassword}
            </code>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(newPassword);
                  } catch {
                    // Clipboard can be blocked; the value is on screen to copy by
                    // hand, so failing silently here is better than an error the
                    // owner cannot act on.
                  }
                }}
                className="btn btn-sm btn-secondary"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </button>
              <button
                type="button"
                onClick={() => setNewPassword(null)}
                className="btn btn-sm btn-primary"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-[12px] text-ink-subtle">
        <KeyRound className="mt-px h-3.5 w-3.5 shrink-0" />
        Resetting generates a new random password on the server and revokes all live
        sessions. The new password is shown once and is not recoverable afterwards.
      </p>
    </div>
  );
}
