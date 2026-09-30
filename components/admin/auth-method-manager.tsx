"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, ShieldCheck } from "lucide-react";

import { apiFetch, ApiClientError } from "@/lib/api-client";
import { Alert, type AlertMessage } from "@/components/ui/alert";
import { PasswordInput } from "@/components/ui/password-input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import type { SafeAuthMethodConfig } from "@/lib/auth-method";

/**
 * Operator controls for the email+password sign-in method.
 *
 * Deliberately the same shape as OAuthProviderManager: one card, one Enable
 * button, one write-only credential form. An operator configuring sign-in
 * methods should not have to learn two different screens.
 *
 * The one extra rule is the ENABLE GATE: the button stays disabled until a mail
 * transport exists, and the reason is spelled out on the card. Enabling without
 * SMTP would mean every new signup could never be verified — the server refuses
 * it, and this makes that visible before the click rather than after it.
 */
export function AuthMethodManager({
  method,
}: {
  method: SafeAuthMethodConfig;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<AlertMessage | null>(null);
  const [draft, setDraft] = useState({
    smtpHost: "",
    smtpPort: "587",
    smtpSecure: "starttls" as "starttls" | "ssl" | "none",
    smtpUser: "",
    smtpPassword: "",
    mailFrom: "",
  });

  // Shown as placeholders, so the operator sees what is already stored without
  // the fields being pre-filled with a value they would then have to clear.
  const storedHost = method.smtpHost ?? "";
  const storedUser = method.smtpUser ?? "";

  /** True when a transport exists, so Enable is worth offering. */
  const canEnable = method.mailConfigured;

  async function save(patch: Record<string, unknown>, successMessage: string) {
    setSaving(true);
    setAlert(null);
    try {
      await apiFetch("/api/admin/auth-methods", {
        method: "PATCH",
        body: { method: "email_password", ...patch },
      });
      toast({ tone: "success", title: successMessage });
      // Clear the write-only field so a password is never left sitting in
      // component state after a successful save.
      setDraft((prev) => ({ ...prev, smtpPassword: "" }));
      router.refresh();
    } catch (error) {
      setAlert({
        variant: "error",
        message: error instanceof ApiClientError ? error.message : "Could not save.",
      });
    } finally {
      setSaving(false);
    }
  }

  function submitTransport(event: FormEvent) {
    event.preventDefault();
    const patch: Record<string, unknown> = {};
    if (draft.smtpHost.trim()) patch.smtpHost = draft.smtpHost.trim();
    if (draft.smtpUser.trim()) patch.smtpUser = draft.smtpUser.trim();
    if (draft.smtpPassword.trim()) patch.smtpPassword = draft.smtpPassword.trim();
    if (draft.mailFrom.trim()) patch.mailFrom = draft.mailFrom.trim();
    if (draft.smtpPort.trim()) patch.smtpPort = Number(draft.smtpPort);
    patch.smtpSecure = draft.smtpSecure;

    if (Object.keys(patch).length <= 1) {
      setAlert({ variant: "info", message: "Enter at least a host name first." });
      return;
    }
    void save(patch, "SMTP settings saved");
  }

  return (
    <div className="space-y-4">
      {alert ? <Alert {...alert} /> : null}

      <section className="card p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold text-ink">
              Email &amp; password
            </h3>
            <p className="mt-0.5 text-[12px] text-ink-muted">
              {method.enabled ? "Accepting new sign-ins" : "Not accepting sign-ins"}
              {method.enabled && !method.allowRegistration
                ? " · registration closed"
                : ""}
            </p>
          </div>
          <button
            type="button"
            disabled={saving || (!method.enabled && !canEnable)}
            onClick={() =>
              save(
                { enabled: !method.enabled },
                method.enabled
                  ? "Email and password disabled"
                  : "Email and password enabled",
              )
            }
            className={cn(
              "btn btn-sm",
              method.enabled ? "btn-secondary" : "btn-primary",
            )}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            {method.enabled ? "Disable" : "Enable"}
          </button>
        </header>

        {/*
          The enable gate, stated rather than implied. An operator who cannot
          find the button is far more likely to conclude the feature is broken
          than to go looking for the reason.
        */}
        {!method.enabled && !canEnable ? (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-warn-500/30 bg-warn-900/30 px-3.5 py-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-warn-400" />
            <p className="text-[13px] text-warn-400">
              Save your SMTP settings below first. This method proves an email
              address, so enabling it without a working mail transport would
              leave every new account unable to verify.
            </p>
          </div>
        ) : null}

        <div className="mt-4 border-t border-line pt-4">
          <p className="text-[13px] font-medium text-ink">Registration</p>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            Turn this off to keep sign-in working for existing accounts while
            refusing new signups.
          </p>
          <label className="mt-3 flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              className="checkbox"
              checked={method.allowRegistration}
              disabled={saving}
              onChange={(e) =>
                save(
                  { allowRegistration: e.target.checked },
                  e.target.checked
                    ? "Registration opened"
                    : "Registration closed",
                )
              }
            />
            <span className="text-[13px] text-ink">
              Allow new accounts to register
            </span>
          </label>
        </div>
      </section>

      <section className="card p-5">
        <header>
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Mail className="h-4 w-4 text-ink-muted" />
            SMTP transport
          </h3>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            Where verification and password-setup codes are sent from.
            {method.mailConfigured ? " Configured." : " Not configured yet."}
          </p>
        </header>

        <form onSubmit={submitTransport} className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="smtp-host">
              SMTP host
            </label>
            <input
              id="smtp-host"
              className="input font-mono text-[12px]"
              value={draft.smtpHost}
              onChange={(e) => setDraft((p) => ({ ...p, smtpHost: e.target.value }))}
              placeholder={storedHost || "smtp.example.com"}
              autoComplete="off"
            />
            <p className="mt-1 text-[11px] text-ink-subtle">
              Host name only — no scheme, port or path.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="smtp-port">
              Port
            </label>
            <input
              id="smtp-port"
              type="number"
              min={1}
              max={65535}
              className="input font-mono text-[12px]"
              value={draft.smtpPort}
              onChange={(e) => setDraft((p) => ({ ...p, smtpPort: e.target.value }))}
              placeholder={String(method.smtpPort)}
            />
          </div>

          <div>
            <label className="label" htmlFor="smtp-secure">
              Encryption
            </label>
            <select
              id="smtp-secure"
              className="input"
              value={draft.smtpSecure}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  smtpSecure: e.target.value as "starttls" | "ssl" | "none",
                }))
              }
            >
              <option value="starttls">STARTTLS (port 587)</option>
              <option value="ssl">SSL/TLS (port 465)</option>
              <option value="none">None (local relay)</option>
            </select>
          </div>

          <div>
            <label className="label" htmlFor="smtp-user">
              Username
            </label>
            <input
              id="smtp-user"
              className="input font-mono text-[12px]"
              value={draft.smtpUser}
              onChange={(e) => setDraft((p) => ({ ...p, smtpUser: e.target.value }))}
              placeholder={storedUser || "apikey"}
              autoComplete="off"
            />
          </div>

          <div>
            <label className="label" htmlFor="smtp-pass">
              Password
            </label>
            <PasswordInput
              id="smtp-pass"
              type="password"
              className="font-mono text-[12px]"
              value={draft.smtpPassword}
              onChange={(e) =>
                setDraft((p) => ({ ...p, smtpPassword: e.target.value }))
              }
              placeholder={method.hasSmtpPassword ? "•••••••• (saved)" : ""}
              autoComplete="new-password"
            />
            <p className="mt-1 text-[11px] text-ink-subtle">
              Write-only. Leave blank to keep the stored password.
            </p>
          </div>

          <div className="sm:col-span-2">
            <label className="label" htmlFor="mail-from">
              From address
            </label>
            <input
              id="mail-from"
              type="email"
              className="input font-mono text-[12px]"
              value={draft.mailFrom}
              onChange={(e) => setDraft((p) => ({ ...p, mailFrom: e.target.value }))}
              placeholder={method.mailFrom || "no-reply@example.com"}
              autoComplete="off"
            />
          </div>

          <div className="sm:col-span-2 flex justify-end">
            <button type="submit" disabled={saving} className="btn btn-sm btn-primary">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Save SMTP settings
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
