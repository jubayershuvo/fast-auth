"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, KeyRound, MailCheck } from "lucide-react";

import { apiFetch, ApiClientError } from "@/lib/api-client";
import { Alert, FieldError, Spinner, type AlertMessage } from "@/components/ui/alert";
import { ConfirmPasswordField, PasswordInput } from "@/components/ui/password-input";
import { CodeInput } from "@/components/ui/code-input";
import { Modal } from "@/components/ui/modal";

/**
 * Recover a password you cannot sign in with.
 *
 * ONE flow for BOTH cases, which is the reason this screen exists separately
 * from "set a password": the person cannot tell whether they forgot a password
 * or never had one. Both arrive here unable to sign in, so both are handled
 * identically — the server replaces an existing password or writes the first
 * one, and tells the caller nothing about which happened.
 *
 * THREE steps rather than one long form, because each answers a different
 * question and the order is the point:
 *
 *   1. which account?   — email OR username, since nobody remembers which
 *   2. can you read it? — the code alone, in six single boxes
 *   3. what now?        — password + confirm, only once step 2 passed
 *
 * Step 2 is gated on the SERVER (`/verify`), not merely on six digits being
 * present. Showing a password form to someone who never received the code only
 * collects a password they then cannot use.
 */
export function ForgotPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  // Carried over from the sign-in screen so the identifier is not retyped.
  const initialEmail = params.get("email") ?? "";

  const [identifier, setIdentifier] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  /** 0 = ask who, 1 = enter the code, 2 = choose a password. */
  const [step, setStep] = useState<0 | 1 | 2>(0);
  /** The masked address the server confirmed, shown from step 1 onwards. */
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  /** True when step 1 matched nothing — the copy changes, the flow does not. */
  const [notFound, setNotFound] = useState(false);

  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<AlertMessage | null>(null);

  function reset() {
    setStep(0);
    setCode("");
    setPassword("");
    setConfirmPassword("");
    setMaskedEmail(null);
    setNotFound(false);
    setAlert(null);
  }

  /** Step 1 — which account, and send the code. */
  async function onRequestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setAlert(null);

    try {
      const result = await apiFetch<{ sent: boolean; maskedEmail: string }>(
        "/api/auth/forgot-password",
        { method: "POST", body: { identifier } },
      );
      setMaskedEmail(result.maskedEmail || null);
      setNotFound(!result.sent);
      setCode("");
      setStep(1);
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

  /** Step 2 — the code alone. Only a real one opens the password form. */
  async function onVerifyCode(event?: FormEvent) {
    event?.preventDefault();
    if (code.length !== 6) return;

    setPending(true);
    setAlert(null);

    try {
      const result = await apiFetch<{ valid: boolean; maskedEmail: string }>(
        "/api/auth/forgot-password/verify",
        { method: "POST", body: { identifier, code } },
      );
      setMaskedEmail(result.maskedEmail || maskedEmail);
      setStep(2);
    } catch (error) {
      setAlert({
        variant: "error",
        message:
          error instanceof ApiClientError
            ? error.message
            : "That code is not valid. Request a new one.",
      });
      // Stay on step 1 so the digits can be corrected in place.
      setStep(1);
    } finally {
      setPending(false);
    }
  }

  /** Step 3 — the new password. The server signs this browser in. */
  async function onConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Before the code is spent — see the note in `set-password-form`.
    if (password !== confirmPassword) {
      setAlert({ variant: "error", message: "Passwords do not match." });
      return;
    }

    setPending(true);
    setAlert(null);

    try {
      await apiFetch<{ user: { id: string } }>("/api/auth/forgot-password/confirm", {
        method: "POST",
        body: { identifier, code, password },
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

  // ── Step 2: the code, on its own ───────────────────────────────────────
  if (step === 1) {
    return (
      <form onSubmit={onVerifyCode} noValidate className="space-y-4">
        {alert ? <Alert {...alert} /> : null}

        <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-900 p-3.5">
          <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
          <p className="text-[13px] text-ink-muted">
            {notFound ? (
              <>
                We could not find an account for{" "}
                <span className="text-ink">{identifier}</span>. Check the
                spelling, or try your username instead.
              </>
            ) : (
              <>
                We sent a 6-digit code to{" "}
                <span className="text-ink">{maskedEmail}</span>. Enter it below
                to continue.
              </>
            )}
          </p>
        </div>

        {/* Said before the code, not after: this is the one flow that ends other
            sessions, and finding out by being logged out elsewhere is alarming. */}
        <p className="text-[12px] text-ink-subtle">
          Setting a new password signs you out everywhere else.
        </p>

        <CodeInput
          id="reset-code"
          value={code}
          onChange={setCode}
          onComplete={() => void onVerifyCode()}
          autoFocus
          disabled={pending}
          invalid={alert?.variant === "error"}
        />

        <button
          type="submit"
          disabled={pending || code.length !== 6}
          className="btn btn-md btn-primary w-full"
        >
          {pending ? (
            <>
              <Spinner />
              Checking…
            </>
          ) : (
            <>
              Continue
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>

        <div className="flex items-center justify-between pt-1 text-sm">
          <button
            type="button"
            onClick={reset}
            className="font-medium text-brand-400 hover:text-brand-300"
          >
            Use a different account
          </button>
          <Link href="/login" className="text-ink-muted hover:text-ink">
            Back to sign in
          </Link>
        </div>
      </form>
    );
  }
  // ── Step 3: the new password, as a dialog ──────────────────────────────
  // A dialog, not a third page step: the code is already proven, so what is
  // left is a short, self-contained commitment. Modal on purpose too — going
  // back should be a deliberate act, not a stray backspace.
  if (step === 2) {
    return (
      <Modal
        open
        onClose={reset}
        title="Choose a new password"
        description={
          maskedEmail
            ? `Signed in as ${identifier}. The code was sent to ${maskedEmail}.`
            : `Signed in as ${identifier}.`
        }
        size="sm"
        footer={
          <button
            type="button"
            onClick={reset}
            className="btn btn-md btn-secondary"
          >
            Back
          </button>
        }
      >
        <form onSubmit={onConfirm} noValidate className="space-y-4">
          {alert ? <Alert {...alert} /> : null}

          <div>
            <label htmlFor="password" className="label">
              New password
            </label>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="new-password"
              required
              autoFocus
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setAlert(null);
              }}
            />
            <FieldError message={alert?.fields?.password} />
            <p className="mt-1.5 text-[12px] text-ink-subtle">
              At least 8 characters, with upper case, lower case and a number.
            </p>
          </div>

          <ConfirmPasswordField
            id="confirm-password"
            password={password}
            value={confirmPassword}
            onChange={setConfirmPassword}
            fieldError={alert?.fields?.confirmPassword}
          />

          <p className="text-[12px] text-ink-subtle">
            We will email you a notice when the password changes, and sign you in
            on this device.
          </p>

          <button
            type="submit"
            disabled={pending}
            className="btn btn-md btn-primary w-full"
          >
            {pending ? (
              <>
                <Spinner />
                Saving…
              </>
            ) : (
              <>
                Set new password
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>
      </Modal>
    );
  }

  // ── Step 1: which account ───────────────────────────────────────────────
  return (
    <form onSubmit={onRequestCode} noValidate className="space-y-4">
      {alert ? <Alert {...alert} /> : null}

      <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-900 p-3.5">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
        <p className="text-[13px] text-ink-muted">
          Enter your email <span className="text-ink-subtle">or username</span>{" "}
          and we&apos;ll send a 6-digit code so you can choose a new password.
        </p>
      </div>

      <div>
        <label htmlFor="identifier" className="label">
          Email or username
        </label>
        {/*
          `type="text"`, NOT `type="email"`. A username is a valid thing to type
          here, and the browser's own email validation would block the form on
          a perfectly good username before the request is ever sent.
          `autoComplete="username"` is what offers the saved identities.
        */}
        <input
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          spellCheck={false}
          required
          autoFocus
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          className="input"
          placeholder="you@company.com or your username"
        />
        <FieldError message={alert?.fields?.identifier} />
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

      {/* The sibling flow, kept reachable: "set a password" is for an account an
          operator created and which has never had one, and it deliberately
          refuses to touch an account that already works. */}
      <p className="text-center text-sm text-ink-muted">
        Never had a password?{" "}
        <Link href="/set-password" className="font-medium text-brand-400 hover:text-brand-300">
          Set one by email
        </Link>
      </p>

      <p className="pt-1 text-center text-sm text-ink-muted">
        <Link href="/login" className="font-medium text-brand-400 hover:text-brand-300">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}