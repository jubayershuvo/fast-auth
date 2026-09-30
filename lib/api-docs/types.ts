/**
 * Types for the API reference.
 *
 * The endpoint catalogue in this folder is the SINGLE SOURCE OF TRUTH for the
 * documentation. It renders the in-app docs at /docs AND generates the
 * OpenAPI 3.1 spec at /docs/openapi.json, so the two can never drift apart.
 *
 * This file is isomorphic (no `server-only`) so it can be imported by both
 * server components and client components.
 */

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** How a request proves who it is. */
export type AuthKind =
  | "none"
  /** `Authorization: Bearer <sessionToken>` — the customer's end user. */
  | "bearer"
  /** httpOnly `fa_session` cookie — the dashboard customer. */
  | "cookie"
  /**
 * httpOnly `fa_admin_session` cookie — the platform operator. */
  | "admin-cookie"
  /** httpOnly `fa_app_session` cookie — an application's own end user, in a browser. */
  | "portal-cookie"
  /** `X-Api-Key: fak_...` — a server-to-server management credential. */
  | "api-key";

export type GroupId = "v1" | "keys" | "dashboard" | "admin" | "portal";

export type ParamDoc = {
  name: string;
  in: "path" | "query" | "body" | "header";
  type: string;
  required: boolean;
  description: string;
  example?: string;
};

export type CodeSample = {
  lang: "bash" | "json" | "javascript" | "python" | "text";
  code: string;
};

export type ErrorDoc = {
  status: number;
  code: string;
  when: string;
};

export type EndpointDoc = {
  id: string;
  method: HttpMethod;
  path: string;
  group: GroupId;
  title: string;
  summary: string;
  auth: AuthKind;
  /**
   * Full parameter reference. Endpoints without it are rendered as a compact
   * reference row — appropriate for straightforward management calls where the
   * summary plus the OpenAPI spec tell the whole story.
   */
  params?: ParamDoc[];
  requestExample?: CodeSample;
  /** Omitted for compact entries. */
  responseExample?: CodeSample;
  errors?: ErrorDoc[];
  notes?: string[];
  /** Status codes returned on success, for the compact rendering. */
  successStatus?: number;
};

export type GroupMeta = {
  id: GroupId;
  label: string;
  blurb: string;
  anchor: string;
};

export const GROUPS: GroupMeta[] = [
  {
    id: "v1",
    label: "Public API",
    blurb:
      "Called from your game, desktop app or script. Authenticates an END USER with a bearer token.",
    anchor: "public-api",
  },
  {
    id: "keys",
    label: "API keys",
    blurb:
      "For your BACKEND. A machine credential in the X-Api-Key header — no cookie, no browser. A platform key manages every application; an app key manages one application's users and devices.",
    anchor: "api-keys",
  },
  {
    id: "dashboard",
    label: "Dashboard API",
    blurb:
      "Called by the FastAuth dashboard. Manages your applications and their users from a browser session.",
    anchor: "dashboard-api",
  },
  {
    id: "portal",
    label: "End-user portal API",
    blurb:
      "Called by the self-service portal at /portal, where one of YOUR application's end users signs in to see their expiry date, change their password and manage their devices. Not for your backend — that is the v1 API.",
    anchor: "end-user-portal-api",
  },
  {
    id: "admin",
    label: "Operator API",
    blurb:
      "Platform-operator only. Manage subscription plans and social sign-in providers. Not for customer use.",
    anchor: "operator-api",
  },
];

/** Every machine-readable error code the API can return. */
export const ERROR_CODES: Array<{ code: string; status: number; meaning: string }> = [
  { code: "VALIDATION_ERROR", status: 400, meaning: "The request body or query failed validation." },
  { code: "PASSWORD_UNCHANGED", status: 400, meaning: "A password change supplied the password already in force." },
  { code: "METHOD_NOT_ALLOWED", status: 405, meaning: "That HTTP method is not supported on this path." },
  { code: "PAYLOAD_TOO_LARGE", status: 413, meaning: "The request body exceeded the size limit." },
  { code: "UNAUTHORIZED", status: 401, meaning: "No session, or the session is missing/expired." },
  { code: "INVALID_CREDENTIALS", status: 401, meaning: "Email/username or password is wrong." },
  { code: "SESSION_EXPIRED", status: 401, meaning: "The session token has passed its expiry." },
  { code: "SESSION_REVOKED", status: 401, meaning: "The session was revoked by the owner or by logout." },
  { code: "INVALID_APP_SECRET", status: 401, meaning: "The `appSecret` supplied does not match." },
  { code: "CURRENT_PASSWORD_INCORRECT", status: 401, meaning: "The `currentPassword` on a self-service change did not match." },
  { code: "EMAIL_NOT_VERIFIED", status: 403, meaning: "Sign in refused: confirm the emailed code first." },
  { code: "NO_PASSWORD_SET", status: 409, meaning: "This account has no password (operator- or OAuth-created). `details.providers` names the platforms it is linked to. Request a code to set one." },
  { code: "INVALID_VERIFICATION_CODE", status: 400, meaning: "The 6-digit code is wrong, or none was ever issued." },
  { code: "VERIFICATION_CODE_EXPIRED", status: 400, meaning: "The code was correct but has passed its expiry." },
  { code: "TOO_MANY_CODE_ATTEMPTS", status: 429, meaning: "Too many wrong codes; the code was destroyed. Request a new one." },
  { code: "EMAIL_DELIVERY_FAILED", status: 503, meaning: "The code could not be sent. Retry shortly." },
  { code: "AUTH_METHOD_DISABLED", status: 403, meaning: "The email+password sign-in method is switched off on this deployment." },
  { code: "INVALID_API_KEY", status: 401, meaning: "The `X-Api-Key` is missing, unknown, expired or revoked." },
  { code: "API_KEY_SCOPE_DENIED", status: 403, meaning: "The key is valid but not scoped to this application." },
  { code: "DEVICE_STILL_ACTIVE", status: 409, meaning: "A portal device cannot be removed yet — it was active too recently. Wait for the idle window to pass; this is a timing answer, not a permission one." },
  { code: "FORBIDDEN", status: 403, meaning: "Authenticated, but not allowed to do this." },
  { code: "ACCOUNT_BANNED", status: 403, meaning: "The application user is banned." },
  { code: "ACCOUNT_EXPIRED", status: 403, meaning: "The application user's expiry has passed." },
  { code: "DEVICE_LIMIT_REACHED", status: 403, meaning: "The user already has `maxDevices` registered." },
  { code: "DEVICE_MISMATCH", status: 403, meaning: "The token was issued to a different device." },
  { code: "APP_LIMIT_REACHED", status: 403, meaning: "The account has no application slots left on its plan." },
  { code: "NOT_FOUND", status: 404, meaning: "No such resource — or it belongs to another account." },
  { code: "INVALID_APPLICATION", status: 404, meaning: "The `appId` does not exist." },
  { code: "USER_NOT_FOUND", status: 404, meaning: "No such application user in this application." },
  { code: "EMAIL_TAKEN", status: 409, meaning: "That email is already registered." },
  { code: "USERNAME_TAKEN", status: 409, meaning: "That username already exists in this application." },
  { code: "DUPLICATE", status: 409, meaning: "A unique value collided (rare; safe to retry)." },
  { code: "INVALID_PLAN", status: 400, meaning: "The requested plan id is not one FastAuth offers." },
  { code: "RATE_LIMITED", status: 429, meaning: "Too many attempts. Wait for the window to reset." },
  { code: "TOO_MANY_SESSIONS", status: 429, meaning: "The user already holds `MAX_SESSIONS_PER_USER` live sessions." },
  { code: "INTERNAL_ERROR", status: 500, meaning: "Unexpected server error. Safe to retry." },
  { code: "SERVICE_UNAVAILABLE", status: 503, meaning: "The database is unavailable. Retry shortly." },
  { code: "APP_SUSPENDED", status: 503, meaning: "The owner stopped this application. Retry after starting it again." },
];
