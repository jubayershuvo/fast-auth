"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, ShieldCheck } from "lucide-react";

import { apiFetch, ApiClientError } from "@/lib/api-client";
import { Alert, type AlertMessage } from "@/components/ui/alert";
import { PasswordInput } from "@/components/ui/password-input";
import { useToast } from "@/components/ui/toast";
import { useBaseUrl } from "@/components/docs/use-base-url";
import { cn } from "@/lib/cn";
import type { SafeProviderConfig } from "@/lib/oauth-config";

/**
 * Operator controls for each OAuth provider.
 *
 * The client secret input is write-only: the server never returns the stored
 * value, so leaving the field blank keeps the existing secret. The UI states
 * this so an operator does not mistake it for an empty field.
 */
export function OAuthProviderManager({
  providers,
}: {
  providers: SafeProviderConfig[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  // Resolved from the address bar, so the operator copies the exact URI this
  // deployment expects rather than a generic placeholder they must edit.
  const baseUrl = useBaseUrl();
  const [saving, setSaving] = useState<string | null>(null);
  const [alert, setAlert] = useState<AlertMessage | null>(null);
  const [drafts, setDrafts] = useState<
    Record<string, { clientId: string; clientSecret: string }>
  >({});

  function draft(provider: string) {
    return drafts[provider] ?? { clientId: "", clientSecret: "" };
  }

  function setDraft(
    provider: string,
    patch: Partial<{ clientId: string; clientSecret: string }>,
  ) {
    setDrafts((prev) => ({ ...prev, [provider]: { ...draft(provider), ...patch } }));
  }

  async function save(
    provider: SafeProviderConfig,
    patch: Record<string, unknown>,
  ) {
    setSaving(provider.provider);
    setAlert(null);
    try {
      await apiFetch("/api/admin/oauth/providers", {
        method: "PATCH",
        body: { provider: provider.provider, ...patch },
      });
      toast({ tone: "success", title: `${provider.label} updated` });
      setDrafts((prev) => ({
        ...prev,
        [provider.provider]: { clientId: "", clientSecret: "" },
      }));
      router.refresh();
    } catch (error) {
      setAlert({
        variant: "error",
        message: error instanceof ApiClientError ? error.message : "Could not save.",
      });
    } finally {
      setSaving(null);
    }
  }

  function submitCredentials(provider: SafeProviderConfig, event: FormEvent) {
    event.preventDefault();
    const values = draft(provider.provider);
    const patch: Record<string, unknown> = {};
    if (values.clientId.trim()) patch.clientId = values.clientId.trim();
    if (values.clientSecret.trim()) patch.clientSecret = values.clientSecret.trim();
    if (Object.keys(patch).length === 0) {
      setAlert({ variant: "info", message: "Enter a client id or secret first." });
      return;
    }
    void save(provider, patch);
  }

  return (
    <div className="space-y-4">
      {alert ? <Alert {...alert} /> : null}

      {providers.map((provider) => {
        const busy = saving === provider.provider;
        const values = draft(provider.provider);
        return (
          <section key={provider.provider} className="card p-5">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-semibold text-ink">{provider.label}</h3>
                <p className="mt-0.5 text-[12px] text-ink-muted">
                  {provider.hasSecret ? "Credentials saved" : "No credentials saved yet"}
                  {provider.clientId ? ` · ${provider.clientId.slice(0, 18)}…` : ""}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => save(provider, { enabled: !provider.enabled })}
                className={cn("btn btn-sm", provider.enabled ? "btn-secondary" : "btn-primary")}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {provider.enabled ? "Disable" : "Enable"}
              </button>
            </header>

            <form
              onSubmit={(e) => submitCredentials(provider, e)}
              className="mt-4 grid gap-3 sm:grid-cols-2"
            >
              <div>
                <label className="label" htmlFor={`${provider.provider}-client-id`}>
                  Client ID
                </label>
                <input
                  id={`${provider.provider}-client-id`}
                  className="input font-mono text-[12px]"
                  value={values.clientId}
                  onChange={(e) => setDraft(provider.provider, { clientId: e.target.value })}
                  placeholder={provider.clientId ?? "paste client id"}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="label" htmlFor={`${provider.provider}-client-secret`}>
                  Client secret
                </label>
                <PasswordInput
                  id={`${provider.provider}-client-secret`}
                  type="password"
                  className="font-mono text-[12px]"
                  value={values.clientSecret}
                  onChange={(e) => setDraft(provider.provider, { clientSecret: e.target.value })}
                  placeholder={provider.hasSecret ? "•••••••• (unchanged)" : "paste client secret"}
                  autoComplete="new-password"
                />
              </div>
              <div className="sm:col-span-2">
                <button type="submit" disabled={busy} className="btn btn-sm btn-secondary">
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Save credentials
                </button>
                <p className="mt-2 text-[12px] text-ink-subtle">
                  Secrets are encrypted with AES-256-GCM before storage and are never
                  displayed again. Leave the field blank to keep the current secret.
                </p>
              </div>
            </form>


            <div className="mt-4 flex flex-wrap gap-4 border-t border-line pt-4">
              <label className="flex items-center gap-2 text-[13px] text-ink-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-line-strong bg-surface-950"
                  checked={provider.allowCustomerLogin}
                  onChange={(e) =>
                    save(provider, { allowCustomerLogin: e.target.checked })
                  }
                />
                Customer sign-in
              </label>
              <label className="flex items-start gap-2 text-[13px] text-ink-muted">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-line-strong bg-surface-950"
                  checked={provider.allowAdminLogin}
                  onChange={(e) => save(provider, { allowAdminLogin: e.target.checked })}
                />
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-warn-400" />
                  Admin sign-in (never creates an account)
                </span>
              </label>
            </div>

            {provider.provider === "azure" ? (
              <div className="mt-4">
                <label className="label" htmlFor="azure-tenant">
                  Tenant
                </label>
                <input
                  id="azure-tenant"
                  className="input font-mono text-[12px]"
                  defaultValue={String(provider.settings.tenant ?? "common")}
                  onBlur={(e) =>
                    save(provider, {
                      settings: { ...provider.settings, tenant: e.target.value.trim() },
                    })
                  }
                  placeholder="common"
                />
                <p className="mt-1.5 text-[12px] text-ink-subtle">
                  `common`, `organizations`, `consumers`, or a directory (tenant) GUID.
                </p>
              </div>
            ) : null}
          </section>
        );
      })}

      <Alert variant="info">
        Register these exact redirect URIs with your provider. They are derived
        from this deployment&apos;s own address, so they work on localhost,
        preview domains and production alike.
        <ul className="mt-2 space-y-1 font-mono text-[12px]">
          <li>
            Customer sign-in:{" "}
            <span className="text-brand-300">
              {baseUrl}/api/auth/oauth/&lt;provider&gt;/callback
            </span>
          </li>
          <li>
            Operator sign-in:{" "}
            <span className="text-brand-300">
              {baseUrl}/api/admin/oauth/&lt;provider&gt;/callback
            </span>
          </li>
        </ul>
      </Alert>
    </div>
  );
}

