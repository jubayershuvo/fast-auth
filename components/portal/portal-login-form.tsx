"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LogIn } from "lucide-react";

import { apiFetch, ApiClientError } from "@/lib/api-client";
import { Alert, FieldError, Spinner, type AlertMessage } from "@/components/ui/alert";
import { PasswordInput } from "@/components/ui/password-input";

/**
 * Portal sign-in for ONE application, at `/apps/<appId>/login`.
 *
 * Two fields, not three. The application comes from the URL rather than an
 * input, because an end-user username is only unique *within* an application —
 * there is nothing to sign in to until the application is known, and a person
 * should never have to copy an id out of an email to prove who they are.
 *
 * This is NOT the customer sign-in form at `/login` and not the operator's.
 * Each realm has its own screen, cookie and password store; sharing one form
 * would offer end-user credentials somewhere that could never accept them.
 */
export function PortalLoginForm({ appId }: { appId: string }) {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<AlertMessage | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setAlert(null);

    try {
      await apiFetch("/api/portal/auth/login", {
        method: "POST",
        // `appId` still travels in the BODY: the endpoint is a public API that
        // can be called directly, and must not depend on this page's routing.
        body: { appId, username, password },
      });
      router.replace(`/apps/${encodeURIComponent(appId)}/dashboard`);
      router.refresh();
    } catch (error) {
      setAlert({
        variant: "error",
        message:
          error instanceof ApiClientError
            ? error.message
            : "Something went wrong. Please try again.",
        fields: error instanceof ApiClientError ? error.details : undefined,
      });
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="w-full space-y-4">
      {alert ? <Alert {...alert} /> : null}

      <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-900 p-3.5">
        <LogIn className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
        <p className="text-[13px] text-ink-muted">
          Sign in to see when your account expires, change your password, and
          manage your devices.
        </p>
      </div>

      <div>
        <label htmlFor="username" className="label">
          Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          required
          autoFocus
          autoComplete="username"
          spellCheck={false}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          className="input"
          placeholder="player1"
        />
        <FieldError message={alert?.fields?.username} />
      </div>

      <div>
        <label htmlFor="password" className="label">
          Password
        </label>
        <PasswordInput
          id="password"
          name="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="••••••••"
        />
        <FieldError message={alert?.fields?.password} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="btn btn-md btn-primary w-full"
      >
        {pending ? (
          <>
            <Spinner />
            Signing in…
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