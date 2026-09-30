"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, KeyRound, TriangleAlert } from "lucide-react";

import { apiFetch, ApiClientError } from "@/lib/api-client";
import { Alert, FieldError, Spinner, type AlertMessage } from "@/components/ui/alert";
import { PasswordInput } from "@/components/ui/password-input";
import { Modal } from "@/components/ui/modal";
import { ProviderMark } from "@/components/auth/social-auth-buttons";
import type { OAuthProviderId } from "@/lib/oauth-providers";

/** A provider this deployment actually offers, as rendered on the sign-in page. */
type EnabledProvider = { provider: OAuthProviderId; label: string };

/**
 * Reads the provider list out of the failure envelope.
 *
 * `details` is typed as a field-error map everywhere else, so this narrows
 * rather than trusting the shape: an older server, or a proxy returning some
 * other payload, must leave the screen working rather than crash it.
 */
function readProviders(details: unknown): OAuthProviderId[] {
  if (typeof details !== "object" || details === null) return [];
  const raw = (details as { providers?: unknown }).providers;
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is OAuthProviderId =>
    value === "google" || value === "github" || value === "azure",
  );
}

export function LoginForm({ providers = [] }: { providers?: EnabledProvider[] }) {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<AlertMessage | null>(null);

  /**
   * Set when the server says this account has no password. The message the user
   * sees is specific ("request a code by email"), so the screen has to offer
   * that route — otherwise we have told someone to do something with no way to
   * do it.
   *
   * Holds the linked provider ids too, so the dialog can name the platform
   * rather than sending them back to a form they have already failed with.
   */
  const [noPassword, setNoPassword] = useState<{
    email: string | null;
    linked: OAuthProviderId[];
  } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setAlert(null);
    setNoPassword(null);

    try {
      await apiFetch<{ id: string }>("/api/auth/login", {
        method: "POST",
        body: { identifier, password },
      });
      // Full navigation so the server re-renders with the new session cookie;
      // a client-side push would render against the stale (logged-out) RSC cache.
      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.code === "NO_PASSWORD_SET") {
          // Only the identifier is carried across, and only if it looks like an
          // email — the setup form needs an address, and guessing from a
          // username would silently fail.
          const candidate = identifier.trim();
          setNoPassword({
            email: candidate.includes("@") ? candidate : null,
            linked: readProviders(error.details),
          });
        }
        if (error.code === "EMAIL_NOT_VERIFIED") {
          setAlert({
            variant: "warning",
            message: error.message,
          });
          setPending(false);
          return;
        }
        setAlert({
          variant: "error",
          message: error.message,
          fields: error.details,
        });
        setPending(false);
        return;
      }
      setAlert({
        variant: "error",
        message: "Something went wrong. Please try again.",
      });
      setPending(false);
    }
  }

  // Only offer a provider that is BOTH linked to this account AND still
  // enabled. A linked-but-disabled provider would render a button that fails,
  // which is worse than not offering it.
  const usable = providers.filter((item) => noPassword?.linked.includes(item.provider));
  const primary = usable[0];
  const others = usable.slice(1);

  return (
    <>
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {alert ? <Alert {...alert} /> : null}

      <div>
        <label htmlFor="identifier" className="label">
          Email or username
        </label>
        <input
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          required
          autoFocus
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          className="input"
          placeholder="you@company.com"
        />
        <FieldError message={alert?.fields?.identifier} />
      </div>

      <div>
        <label htmlFor="password" className="label">
          Password
        </label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
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

      {/*
        The other dead end. "No password yet" is answered above with a link; a
        forgotten password is answered here, because the person cannot tell the
        two apart from this screen — both arrive at "I cannot sign in". Carrying
        the identifier they typed means they do not retype it.
      */}
      <div className="text-center">
        <Link
          href={`/forgot-password?email=${encodeURIComponent(identifier)}`}
          className="text-sm text-ink-muted transition-colors hover:text-ink"
        >
          Forgot your password?
        </Link>
      </div>

      <p className="pt-1 text-center text-sm text-ink-muted">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="font-medium text-brand-400 hover:text-brand-300">
          Create one
        </Link>
      </p>
    </form>

    {/*
      The "signed up with a platform, tried a password" case.

      A dialog rather than an inline banner, because this is a fork in the road
      rather than a validation error: the form they just filled in cannot work,
      and the two ways forward are entirely different. An inline message sits
      under the password box they are about to type into again, which invites
      exactly the retry loop this exists to stop.
    */}
    <Modal
      open={noPassword !== null}
      onClose={() => setNoPassword(null)}
      title="This account has no password"
      description={
        primary
          ? `${noPassword?.email ?? "This account"} was registered with ${primary.label}, so it was never given a password.`
          : `${noPassword?.email ?? "This account"} was never given a password.`
      }
      size="sm"
      footer={
        <button
          type="button"
          onClick={() => setNoPassword(null)}
          className="btn btn-md btn-secondary"
        >
          Close
        </button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-warn-500/30 bg-warn-900/40 p-3.5">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn-400" />
          <p className="text-[13px] text-ink-muted">
            {primary
              ? "Sign in the way you signed up, or set a password by email to use email and password from now on."
              : "Set a password by email to use email and password from now on."}
          </p>
        </div>

        {/* Plain anchors, not click handlers: the browser follows the redirect
            to the provider directly, which keeps the PKCE state cookie
            (SameSite=Lax) intact across the top-level navigation. */}
        {primary ? (
          <a
            href={`/api/auth/oauth/${primary.provider}/start`}
            className="btn btn-md btn-secondary w-full"
          >
            <ProviderMark provider={primary.provider} />
            Continue with {primary.label}
          </a>
        ) : null}

        {others.map((item) => (
          <a
            key={item.provider}
            href={`/api/auth/oauth/${item.provider}/start`}
            className="btn btn-md btn-secondary w-full"
          >
            <ProviderMark provider={item.provider} />
            Continue with {item.label}
          </a>
        ))}

        {noPassword?.email ? (
          <div className="space-y-2 border-t border-line pt-4">
            <a
              href={`/set-password?email=${encodeURIComponent(noPassword.email)}`}
              className="btn btn-md btn-primary w-full"
            >
              <KeyRound className="h-4 w-4" />
              Set a password by email
            </a>
            <a
              href={`/forgot-password?email=${encodeURIComponent(noPassword.email)}`}
              className="block text-center text-[13px] text-ink-muted transition-colors hover:text-ink"
            >
              Forgot your password?
            </a>
          </div>
        ) : (
          // No email was typed (the identifier was a username), so there is
          // nothing to prefill the recovery forms with. Point at them rather
          // than rendering links that would silently start empty.
          <div className="space-y-2 border-t border-line pt-4">
            <p className="text-[13px] text-ink-muted">
              Enter your email address above to recover this account.
            </p>
          </div>
        )}
      </div>
    </Modal>
    </>
  );
}
