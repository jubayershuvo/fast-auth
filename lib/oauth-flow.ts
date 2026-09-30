import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { ApiError, ErrorCode } from "@/lib/errors";
import { getRequestContext } from "@/lib/request";
import { getProviderConfig } from "@/lib/oauth-config";
import {
  PROVIDER_DEFINITIONS,
  providerUrls,
  type NormalizedProfile,
  type OAuthProviderId,
} from "@/lib/oauth-providers";

/**
 * OAuth 2.0 Authorization Code + PKCE flow.
 *
 * Security properties:
 *   - PKCE (S256) on every request. The verifier never leaves the server;
 *     only its SHA-256 challenge goes to the provider. This is what stops an
 *     intercepted authorization code from being redeemable by a third party.
 *   - `state` is single-use, bound to a short-lived httpOnly cookie, and
 *     compared in constant time on return (CSRF / login-fixation defence).
 *   - The token exchange happens server-side, so the client secret never
 *     reaches the browser.
 */

export const STATE_COOKIE = "fa_oauth_state";
export const STATE_TTL_SECONDS = 600;

export type SealedState = {
  v: string; // PKCE verifier
  s: string; // state
  ip: string | null;
  r: "customer" | "admin";
  p: OAuthProviderId;
};

export type OAuthStartResult = {
  authorizationUrl: string;
  sealed: string;
};

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

/** Build the redirect that starts the flow. */
export async function beginOAuth(
  provider: OAuthProviderId,
  realm: "customer" | "admin",
  request: Request,
): Promise<OAuthStartResult> {
  const config = await getProviderConfig(provider, realm);
  const definition = PROVIDER_DEFINITIONS[provider];
  const { ip } = getRequestContext(request);

  // Fresh verifier + state on every attempt.
  const verifier = base64Url(randomBytes(32));
  const state = base64Url(randomBytes(24));
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  // The callback URL derives from the incoming origin so the same build works
  // on localhost, preview deployments and production without configuration.
  const origin = new URL(request.url).origin;
  const redirectUri = callbackUrl(origin, realm, provider);

  const urls = providerUrls(provider, config.settings.tenant as string | undefined);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: definition.scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "select_account",
  });

  // Verifier + state + ip sealed into one cookie value.
  const sealed: SealedState = { v: verifier, s: state, ip, r: realm, p: provider };

  return {
    authorizationUrl: `${urls.authorizeUrl}?${params.toString()}`,
    sealed: Buffer.from(JSON.stringify(sealed), "utf8").toString("base64url"),
  };
}

export function callbackUrl(
  origin: string,
  realm: "customer" | "admin",
  provider: OAuthProviderId,
): string {
  const base = realm === "admin" ? "/api/admin/oauth" : "/api/auth/oauth";
  return `${origin}${base}/${provider}/callback`;
}

export function readSealedState(sealed: string): SealedState {
  try {
    const parsed = JSON.parse(
      Buffer.from(sealed, "base64url").toString("utf8"),
    ) as SealedState;
    if (!parsed.v || !parsed.s || !parsed.p) throw new Error("incomplete");
    return parsed;
  } catch {
    throw new ApiError(400, ErrorCode.VALIDATION_ERROR, "Invalid OAuth state.");
  }
}

/** Constant-time compare so a timing oracle cannot recover the state. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Exchange the authorization code for a normalised profile.
 * State is validated BEFORE the code is spent, so a forged callback cannot
 * burn a real authorization code.
 */
export async function completeOAuth(params: {
  provider: OAuthProviderId;
  realm: "customer" | "admin";
  code: string;
  returnedState: string;
  sealed: string;
  request: Request;
}): Promise<NormalizedProfile> {
  const sealed = readSealedState(params.sealed);

  if (sealed.p !== params.provider || sealed.r !== params.realm) {
    throw new ApiError(400, ErrorCode.VALIDATION_ERROR, "OAuth state mismatch.");
  }
  if (!safeEqual(sealed.s, params.returnedState)) {
    // A mismatch means this callback did not originate from our own start
    // request: a CSRF attempt, a replayed link, or login fixation.
    throw new ApiError(400, ErrorCode.VALIDATION_ERROR, "Invalid OAuth state.");
  }

  const config = await getProviderConfig(params.provider, params.realm);
  const urls = providerUrls(params.provider, config.settings.tenant as string | undefined);

  const origin = new URL(params.request.url).origin;
  const redirectUri = callbackUrl(origin, params.realm, params.provider);

  const tokenResponse = await fetch(urls.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: sealed.v,
    }),
    cache: "no-store",
  });

  if (!tokenResponse.ok) {
    // Log the status only — never the code or the response body.
    console.error(
      `[oauth] ${params.provider} token exchange rejected (${tokenResponse.status})`,
    );
    throw new ApiError(
      401,
      ErrorCode.INVALID_CREDENTIALS,
      "The provider rejected this sign-in.",
    );
  }

  const tokens = (await tokenResponse.json()) as { access_token?: string };
  if (!tokens.access_token) {
    throw new ApiError(
      401,
      ErrorCode.INVALID_CREDENTIALS,
      "The provider returned no access token.",
    );
  }

  return fetchProfile(params.provider, tokens.access_token, urls.userInfoUrl);
}

async function fetchProfile(
  provider: OAuthProviderId,
  accessToken: string,
  userInfoUrl: string,
): Promise<NormalizedProfile> {
  const definition = PROVIDER_DEFINITIONS[provider];

  const response = await fetch(userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "FastAuth",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new ApiError(
      401,
      ErrorCode.INVALID_CREDENTIALS,
      "Could not read the provider profile.",
    );
  }

  const raw = (await response.json()) as Record<string, unknown>;
  let profile = definition.mapProfile(raw);

  // GitHub's /user endpoint asserts nothing about email verification, so the
  // address is only trusted once /user/emails confirms it.
  if (provider === "github" && !profile.emailVerified) {
    profile = await resolveGithubVerifiedEmail(accessToken, profile);
  }

  if (!profile.providerAccountId) {
    throw new ApiError(
      401,
      ErrorCode.INVALID_CREDENTIALS,
      "The provider profile was incomplete.",
    );
  }
  return profile;
}

async function resolveGithubVerifiedEmail(
  accessToken: string,
  profile: NormalizedProfile,
): Promise<NormalizedProfile> {
  try {
    const response = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "FastAuth",
      },
      cache: "no-store",
    });
    if (!response.ok) return profile;

    const emails = (await response.json()) as Array<{
      email?: string;
      primary?: boolean;
      verified?: boolean;
    }>;

    const best =
      emails.find((entry) => entry.primary && entry.verified) ??
      emails.find((entry) => entry.verified);

    if (best?.email) {
      return { ...profile, email: best.email.toLowerCase(), emailVerified: true };
    }
  } catch {
    // Fall through. Unverified is the safe outcome: it blocks auto-linking.
  }
  return profile;
}

