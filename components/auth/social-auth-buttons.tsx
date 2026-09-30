import { cn } from "@/lib/cn";

export type SocialProvider = { provider: string; label: string };

/** Simple, dependency-free wordmark for each supported provider. */
/** The provider's own glyph. Exported so the "no password" dialog can reuse it. */
export function ProviderMark({ provider }: { provider: string }) {
  const common = "h-4 w-4";
  switch (provider) {
    case "google":
      return (
        <svg viewBox="0 0 24 24" className={common} aria-hidden>
          <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z" />
          <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3a7.2 7.2 0 0 1-10.7-3.8h-4v3.1A12 12 0 0 0 12 24z" />
          <path fill="#FBBC05" d="M5.3 14.3a7.1 7.1 0 0 1 0-4.6v-3h-4a12 12 0 0 0 0 10.7l4-3.1z" />
          <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.5-3.5A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8z" />
        </svg>
      );
    case "github":
      return (
        <svg viewBox="0 0 24 24" className={common} fill="currentColor" aria-hidden>
          <path d="M12 .5a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.2.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.4 4.9 18.4 5.2 18.4 5.2c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .5z" />
        </svg>
      );
    case "azure":
      return (
        <svg viewBox="0 0 24 24" className={common} aria-hidden>
          <path fill="#F25022" d="M9.6 2 2 6.6l7.2 4.1L18 2z" />
          <path fill="#7FBA00" d="M22 6.6 14.4 2l-1.2 8.7L22 10.8z" />
          <path fill="#00A4EF" d="M2 17.4 9.6 22l3.6-11.3L2 17.4z" />
          <path fill="#FFB900" d="M22 17.4 14.4 22 12 10.7l10 6.7z" />
        </svg>
      );
    default:
      return <KeyRoundIcon />;
  }
}

function KeyRoundIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.7 12.3 8.3-8.3M17 6l2 2M14.5 8.5l2 2" />
    </svg>
  );
}

/**
 * Social sign-in buttons.
 *
 * Plain anchors rather than JS handlers: the browser follows the redirect to
 * the provider directly, which keeps the PKCE state cookie (SameSite=Lax)
 * intact across the top-level navigation.
 */
export function SocialAuthButtons({
  providers,
  realm,
  action = "Sign in",
}: {
  providers: SocialProvider[];
  realm: "customer" | "admin";
  action?: string;
}) {
  if (providers.length === 0) return null;

  const base = realm === "admin" ? "/api/admin/oauth" : "/api/auth/oauth";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[11px] uppercase tracking-wider text-ink-subtle">
          or {action.toLowerCase()} with
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <div className="grid gap-2">
        {providers.map((item) => (
          <a
            key={item.provider}
            href={`${base}/${item.provider}/start`}
            className={cn(
              "btn btn-md btn-secondary w-full",
              "justify-center",
            )}
          >
            <ProviderMark provider={item.provider} />
            {item.label}
          </a>
        ))}
      </div>
    </div>
  );
}
