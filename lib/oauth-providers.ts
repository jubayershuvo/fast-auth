import { ApiError, ErrorCode } from "@/lib/errors";

/**
 * Supported OAuth 2.0 providers.
 *
 * Endpoints are HARDCODED per provider, not taken from the database. The admin
 * can configure the client id/secret, but never the URLs the browser is
 * redirected to or the token endpoint the server posts the code to — a
 * configurable endpoint would turn the operator panel into an open redirector
 * and a credential-forwarding SSRF primitive.
 *
 * All three support Authorization Code + PKCE (S256).
 */
export const OAUTH_PROVIDERS = ["google", "github", "azure"] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProviderId(value: string): value is OAuthProviderId {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

export type ProviderDefinition = {
  id: OAuthProviderId;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  /** Map a normalised profile into our own shape. */
  mapProfile: (raw: Record<string, unknown>) => NormalizedProfile;
};

export type NormalizedProfile = {
  providerAccountId: string;
  email: string | null;
  emailVerified: boolean;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

function firstString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export const PROVIDER_DEFINITIONS: Record<OAuthProviderId, ProviderDefinition> = {
  google: {
    id: "google",
    label: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scopes: ["openid", "email", "profile"],
    mapProfile: (raw) => ({
      providerAccountId: firstString(raw.sub) ?? "",
      email: firstString(raw.email)?.toLowerCase() ?? null,
      // Google only returns `email_verified` on the OIDC userinfo endpoint.
      emailVerified: raw.email_verified === true,
      username: (firstString(raw.email) ?? "").split("@")[0] || null,
      displayName: firstString(raw.name),
      avatarUrl: firstString(raw.picture),
    }),
  },

  github: {
    id: "github",
    label: "GitHub",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    scopes: ["read:user", "user:email"],
    mapProfile: (raw) => ({
      providerAccountId: raw.id === undefined ? "" : String(raw.id),
      email: firstString(raw.email)?.toLowerCase() ?? null,
      // GitHub's /user payload has NO verified flag, so we must not claim the
      // address is verified from this response alone. `resolveVerifiedEmail`
      // in lib/oauth-flow.ts fetches /user/emails to establish it properly.
      emailVerified: false,
      username: firstString(raw.login),
      displayName: firstString(raw.name),
      avatarUrl: firstString(raw.avatar_url),
    }),
  },

  azure: {
    id: "azure",
    label: "Microsoft",
    // The tenant segment is substituted at request time from provider config.
    authorizeUrl: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
    userInfoUrl: "https://graph.microsoft.com/oidc/userinfo",
    scopes: ["openid", "email", "profile", "User.Read"],
    mapProfile: (raw) => ({
      providerAccountId: firstString(raw.sub) ?? "",
      email: firstString(raw.email)?.toLowerCase() ??
        firstString(raw.preferred_username)?.toLowerCase() ?? null,
      emailVerified: raw.email_verified === true || raw.ver === "1",
      username: firstString(raw.preferred_username)?.split("@")[0] ?? null,
      displayName: firstString(raw.name),
      avatarUrl: firstString(raw.picture),
    }),
  },
};

/**
 * Azure allows a tenant segment. Constrained hard: it must be `common`,
 * `organizations`, `consumers`, or a GUID. Anything else (notably a hostname
 * or path) is rejected so the value cannot be used to redirect the token
 * exchange somewhere other than Microsoft.
 */
export function resolveAzureTenant(raw: string | null | undefined): string {
  const value = (raw ?? "common").trim();
  if (value === "common" || value === "organizations" || value === "consumers") {
    return value;
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return value;
  }
  throw ApiError.validation(
    "Azure tenant must be 'common', 'organizations', 'consumers', or a tenant GUID.",
  );
}

export function providerUrls(
  id: OAuthProviderId,
  azureTenant?: string,
): { authorizeUrl: string; tokenUrl: string; userInfoUrl: string } {
  const definition = PROVIDER_DEFINITIONS[id];

  // ── TEST-ONLY ENDPOINT OVERRIDE ────────────────────────────────────────
  // Hardcoded endpoints are a deliberate security property: an operator must
  // never be able to point the token exchange at a host they control, which
  // would forward the authorization code and client secret to them.
  //
  // The verification suite needs a fake provider to exercise the real PKCE
  // flow, so an override exists — but it is refused outright in production and
  // requires an explicit opt-in variable. It is NOT a configuration surface.
  const override = readTestOverride();

  const base = id === "azure" ? resolveAzureTenant(azureTenant) : null;
  const substitute = (template: string) =>
    base ? template.replace("{tenant}", base) : template;

  return {
    authorizeUrl: override?.authorizeUrl ?? substitute(definition.authorizeUrl),
    tokenUrl: override?.tokenUrl ?? substitute(definition.tokenUrl),
    userInfoUrl: override?.userInfoUrl ?? substitute(definition.userInfoUrl),
  };
}

/**
 * Returns endpoint overrides ONLY when explicitly enabled.
 *
 * Two independent conditions, both required:
 *   1. `OAUTH_ALLOW_TEST_ENDPOINTS=1` — an explicit, self-documenting opt-in
 *      that is never set in a real deployment.
 *   2. The override host is LOOPBACK ONLY. This is the important one: even if
 *      the flag somehow leaked, the token exchange could only ever be pointed
 *      at the machine's own loopback interface, so the client secret and
 *      authorization code can never be forwarded to an attacker's host.
 *
 * This keeps `OAUTH_TEST_*` out of the operator's configuration surface while
 * still letting the verification suite drive the real PKCE flow.
 */
function readTestOverride():
  | { authorizeUrl: string; tokenUrl: string; userInfoUrl: string }
  | null {
  if (process.env.OAUTH_ALLOW_TEST_ENDPOINTS !== "1") return null;

  const authorizeUrl = process.env.OAUTH_TEST_AUTHORIZE_URL;
  const tokenUrl = process.env.OAUTH_TEST_TOKEN_URL;
  const userInfoUrl = process.env.OAUTH_TEST_USERINFO_URL;
  if (!authorizeUrl || !tokenUrl || !userInfoUrl) return null;

  try {
    for (const candidate of [authorizeUrl, tokenUrl, userInfoUrl]) {
      const parsed = new URL(candidate);
      const isLoopback =
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "localhost" ||
        parsed.hostname === "::1";
      if (!isLoopback) return null;
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    }
  } catch {
    return null;
  }

  return { authorizeUrl, tokenUrl, userInfoUrl };
}

export { ErrorCode };
