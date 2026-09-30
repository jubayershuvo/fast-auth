"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, KeyRound, MailCheck } from "lucide-react";

import { apiFetch, ApiClientError } from "@/lib/api-client";
import { Alert, FieldError, Spinner, type AlertMessage } from "@/components/ui/alert";
import { ConfirmPasswordField, PasswordInput } from "@/components/ui/password-input";

/**
 * Claim a password for an account that has none.
 *
 * Two steps, because the code IS the security: it proves the person asking owns
 * the mailbox on file. Without it, anyone who knew a platform-created account's
 * address could simply claim it.
 *
 * The response to step 1 is deliberately identical for an unknown address, an
 * address that already has a password, and a real one — so this screen cannot be
 * used to find out who has an account.
 */
export function SetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  // Pre-filled by the sign-in screen when it detected NO_PASSWORD_SET.
  const initialEmail = params.get("email") ?? "";

  const [email, setEmail] = useState(initialEmail);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<AlertMessage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Step 1 — ask for the code. */
  async function onRequestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setAlert(null);
    setNotice(null);

    try {
      const result = await apiFetch<{ message: string }>(
        "/api/auth/set-password/request",
        { method: "POST", body: { email } },
      );
      setCodeSent(true);
      setNotice(result.message);
    } catch (error) {
      setAlert({
        variant: "error",
        message:
          error instanceof ApiClientError
            ? error.message
            : "Something went wrong. Please try again.",
        fields: error instanceof ApiClientError ? error.details : undefined,
      });
    } finally {
      setPending(false);
    }
  }

  /** Step 2 — code + new password. The server signs us in on success. */
  async function onConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Ahead of the request: the one-time code is spent by this call, so a
    // mismatch discovered afterwards would mean asking for another email.
    if (password !== confirmPassword) {
      setAlert({ variant: "error", message: "Passwords do not match." });
      return;
    }

    setPending(true);
    setAlert(null);

    try {
      await apiFetch<{ user: { id: string } }>("/api/auth/set-password/confirm", {
        method: "POST",
        body: { email, code, password },
      });
      router.replace("/dashboard");
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

  // ── Step 2: code + password ─────────────────────────────────────────────
  if (codeSent) {
    return (
      <form onSubmit={onConfirm} noValidate className="space-y-4">
        {alert ? <Alert {...alert} /> : null}

        <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-900 p-3.5">
          <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
          <p className="text-[13px] text-ink-muted">
            {notice ?? "If that account has no password, a 6-digit code is on its way."}
          </p>
        </div>

        <div>
          <label htmlFor="code" className="label">
            Verification code
          </label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            className="input tnum font-mono tracking-[0.4em]"
            placeholder="000000"
          />
          <FieldError message={alert?.fields?.code} />
        </div>

        <div>
          <label htmlFor="password" className="label">
            New password
          </label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
          />
          <FieldError message={alert?.fields?.password} />
          <p className="mt-1.5 text-[12px] text-ink-subtle">
            At least 8 characters, with upper case, lower case and a number.
          </p>
        </div>

        {/* The code is consumed on the first submit, so a mistyped password here
            would cost a whole new round trip. Confirmed first. */}
        <ConfirmPasswordField
          id="confirm-password"
          password={password}
          value={confirmPassword}
          onChange={setConfirmPassword}
          fieldError={alert?.fields?.confirmPassword}
        />

        <button
          type="submit"
          disabled={pending || code.length !== 6}
          className="btn btn-md btn-primary w-full"
        >
          {pending ? (
            <>
              <Spinner />
              Saving…
            </>
          ) : (
            <>
              Set password
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>

        <div className="flex items-center justify-between pt-1 text-sm">
          <button
            type="button"
            onClick={() => {
              setCodeSent(false);
              setCode("");
              setNotice(null);
            }}
            className="font-medium text-brand-400 hover:text-brand-300"
          >
            Use a different email
          </button>
          <Link href="/login" className="text-ink-muted hover:text-ink">
            Back to sign in
          </Link>
        </div>
      </form>
    );
  }

  // ── Step 1: which account ───────────────────────────────────────────────
  return (
    <form onSubmit={onRequestCode} noValidate className="space-y-4">
      {alert ? <Alert {...alert} /> : null}

      <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-900 p-3.5">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
        <p className="text-[13px] text-ink-muted">
          Enter the email on your account. If it has no password yet, we&apos;ll
          send a 6-digit code so you can create one.
        </p>
      </div>

      <div>
        <label htmlFor="email" className="label">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="input"
          placeholder="you@company.com"
        />
        <FieldError message={alert?.fields?.email} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="btn btn-md btn-primary w-full"
      >
        {pending ? (
          <>
            <Spinner />
            Sending…
          </>
        ) : (
          <>
            Send code
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>

      <p className="pt-1 text-center text-sm text-ink-muted">
        Already have a password?{" "}
        <Link href="/login" className="font-medium text-brand-400 hover:text-brand-300">
          Sign in
        </Link>
      </p>
    </form>
  );
}

