"use client";

import { useState, type FormEvent } from "react";

import { ArrowRight, ShieldAlert } from "lucide-react";

import { apiFetch, ApiClientError } from "@/lib/api-client";
import { Alert, FieldError, Spinner, type AlertMessage } from "@/components/ui/alert";
import { PasswordInput } from "@/components/ui/password-input";

export function AdminLoginForm() {

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<AlertMessage | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setAlert(null);
    try {
      await apiFetch("/api/admin/auth/login", {
        method: "POST",
        body: { identifier, password },
      });
      // Hard navigation on purpose: the admin cookie is a different namespace
      // from the customer session, so the client router cache (built without
      // it) must be discarded rather than reused.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate: must discard the client router cache
      window.location.assign("/admin");
    } catch (error) {
      setAlert({
        variant: "error",
        message:
          error instanceof ApiClientError ? error.message : "Sign-in failed.",
      });
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {alert ? <Alert {...alert} /> : null}

      <div>
        <label htmlFor="admin-identifier" className="label">
          Email or username
        </label>
        <input
          id="admin-identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          required
          autoFocus
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          className="input"
        />
        <FieldError message={alert?.fields?.identifier} />
      </div>

      <div>
        <label htmlFor="admin-password" className="label">
          Password
        </label>
        <PasswordInput
          id="admin-password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <FieldError message={alert?.fields?.password} />
      </div>

      <button type="submit" disabled={pending} className="btn btn-md btn-primary w-full">
        {pending ? (
          <>
            <Spinner />
            Verifying…
          </>
        ) : (
          <>
            Sign in
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
    </form>
  );
}

export function NoAdminNotice() {
  return (
    <Alert variant="warning">
      <span className="flex items-start gap-2">
        <ShieldAlert className="mt-px h-4 w-4 shrink-0" />
        <span>
          No administrator account exists. Create one from the project root with{" "}
          <code className="font-mono">npm run create-admin</code>. There is
          deliberately no web form for this.
        </span>
      </span>
    </Alert>
  );
}
