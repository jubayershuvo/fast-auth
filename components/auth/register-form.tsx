"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, MailCheck } from "lucide-react";

import { apiFetch, ApiClientError } from "@/lib/api-client";
import { Alert, FieldError, Spinner, type AlertMessage } from "@/components/ui/alert";
import { ConfirmPasswordField, PasswordInput } from "@/components/ui/password-input";

/**
 * Signup, then email verification.
 *
 * Registering no longer signs you in: it creates an UNVERIFIED account and mails
 * a 6-digit code. The second step below is therefore not a nicety — the account
 * is unusable until the code is entered, and pretending otherwise here would
 * bounce the user to /dashboard and straight back to /login.
 */
export function RegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", username: "", password: "" });
  // Deliberately NOT part of `form`: that object is POSTed verbatim to
  // /api/auth/register, and the confirmation is a browser-side check that has no
  // business being transmitted.
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<AlertMessage | null>(null);

  // Set once registration succeeds, which switches the form to "enter code".
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [code, setCode] = useState("");
  const [resendNotice, setResendNotice] = useState<string | null>(null);

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  /** Step 1 — create the account and send the code. */
  async function onRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Before anything is sent: a mismatch here would otherwise create the
    // account and then strand the person at the verification step.
    if (form.password !== confirmPassword) {
      setAlert({ variant: "error", message: "Passwords do not match." });
      return;
    }

    setPending(true);
    setAlert(null);
    setResendNotice(null);

    try {
      await apiFetch<{ verificationRequired: boolean }>("/api/auth/register", {
        method: "POST",
        body: form,
      });
      setAwaitingCode(true);
      setPending(false);
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

  /** Step 2 — confirm the code; the server signs us in on success. */
  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setAlert(null);

    try {
      await apiFetch<{ user: { id: string } }>("/api/auth/verify-email", {
        method: "POST",
        body: { email: form.email, code },
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

  /**
   * Ask for another code. The server answers identically for unknown addresses,
   * so this never reveals whether the email is registered.
   */
  async function onResend() {
    setResendNotice(null);
    setPending(true);
    try {
      const result = await apiFetch<{ message: string }>(
        "/api/auth/resend-verification",
        { method: "POST", body: { email: form.email } },
      );
      setResendNotice(result.message);
    } catch {
      setResendNotice("We could not send another code. Please try again shortly.");
    } finally {
      setPending(false);
    }
  }

  // ── Step 2: enter the code ──────────────────────────────────────────────
  if (awaitingCode) {
    return (
      <form onSubmit={onVerify} noValidate className="space-y-4">
        {alert ? <Alert {...alert} /> : null}

        <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-900 p-3.5">
          <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
          <div>
            <p className="text-[13px] font-medium text-ink">Check your email</p>
            <p className="mt-1 text-[13px] text-ink-muted">
              We sent a 6-digit code to{" "}
              <span className="text-ink">{form.email}</span>. Enter it below to
              activate your account.
            </p>
          </div>
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

        <button
          type="submit"
          disabled={pending || code.length !== 6}
          className="btn btn-md btn-primary w-full"
        >
          {pending ? (
            <>
              <Spinner />
              Verifying…
            </>
          ) : (
            <>
              Verify email
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>

        <div className="flex items-center justify-between pt-1 text-sm">
          <button
            type="button"
            onClick={onResend}
            disabled={pending}
            className="font-medium text-brand-400 hover:text-brand-300 disabled:opacity-50"
          >
            Send another code
          </button>
          <Link href="/login" className="text-ink-muted hover:text-ink">
            Back to sign in
          </Link>
        </div>

        {resendNotice ? (
          <p className="text-center text-[12px] text-ink-subtle">{resendNotice}</p>
        ) : null}
      </form>
    );
  }

  // ── Step 1: the usual signup form ───────────────────────────────────────
  return (
    <form onSubmit={onRegister} noValidate className="space-y-4">
      {alert ? <Alert {...alert} /> : null}

      <div>
        <label htmlFor="name" className="label">
          Full name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          required
          autoFocus
          value={form.name}
          onChange={(event) => update("name", event.target.value)}
          className="input"
          placeholder="Ada Lovelace"
        />
        <FieldError message={alert?.fields?.name} />
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
          value={form.email}
          onChange={(event) => update("email", event.target.value)}
          className="input"
          placeholder="you@company.com"
        />
        <FieldError message={alert?.fields?.email} />
        <p className="mt-1.5 text-[12px] text-ink-subtle">
          We&apos;ll email you a 6-digit code to confirm this address.
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
          autoComplete="username"
          required
          value={form.username}
          onChange={(event) => update("username", event.target.value)}
          className="input"
          placeholder="acme"
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
          autoComplete="new-password"
          required
          value={form.password}
          onChange={(event) => update("password", event.target.value)}
          placeholder="••••••••"
        />
        <FieldError message={alert?.fields?.password} />
        <p className="mt-1.5 text-[12px] text-ink-subtle">
          At least 8 characters, with upper case, lower case and a number.
        </p>
      </div>

      {/* Confirmed before the account is created: a password the person cannot
          reproduce is indistinguishable from a wrong one, and recovering from
          that needs a reset email rather than a second field. */}
      <ConfirmPasswordField
        id="confirm-password"
        password={form.password}
        value={confirmPassword}
        onChange={setConfirmPassword}
        fieldError={alert?.fields?.confirmPassword}
      />

      <button
        type="submit"
        disabled={pending}
        className="btn btn-md btn-primary w-full"
      >
        {pending ? (
          <>
            <Spinner />
            Creating account…
          </>
        ) : (
          <>
            Create account
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>

      <p className="pt-1 text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand-400 hover:text-brand-300">
          Sign in
        </Link>
      </p>
    </form>
  );
}
