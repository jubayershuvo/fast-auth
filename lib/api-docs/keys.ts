import type { EndpointDoc } from "./types";

/**
 * The API-KEY API — the machine realm, authenticated with `X-Api-Key: fak_...`.
 *
 * This is the endpoint set a customer's BACKEND uses. The dashboard API
 * (`/api/dashboard/*`) is the same operations, but cookie-authenticated, which
 * is right for a browser and useless for a provisioning script.
 *
 * TWO SCOPES, ONE HEADER:
 *   - a PLATFORM key manages applications themselves: list every application on
 *     the deployment, create one for a named owner, rename, start/stop, rotate
 *     the secret, delete.
 *   - an APP key is pinned to one application and manages its users and
 *     devices. It cannot see or touch any other application.
 *
 * The `appId` in a path is a lookup key only. Authority always comes from the
 * key, so editing the path can only ever cause a refusal — never wider access.
 */
export const KEY_ENDPOINTS: EndpointDoc[] = [
  {
    id: "keys-me",
    method: "GET",
    path: "/api/keys/me",
    group: "keys",
    title: "Describe the presented key",
    summary:
      "Confirm a key works, and see whether it is platform-scoped or pinned to one application.",
    auth: "api-key",
    notes: [
      "The cheapest possible health check for an integration: a 200 means the key is valid, live and unexpired.",
      "Returns no secret material — just the id, the label and the scope, which is enough to debug a wiring problem.",
    ],
    params: [
      { name: "X-Api-Key", in: "header", type: "string", required: true, description: "Your API key.", example: "fak_AbCdEf…x9" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl {{BASE_URL}}/api/keys/me -H "X-Api-Key: $FASTAUTH_API_KEY"`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": {
    "key": {
      "id": "6abc…", "name": "ci-deploy", "scope": "app",
      "applicationId": "6def…", "header": "X-Api-Key"
    }
  }
}`,
    },
    errors: [{ status: 401, code: "INVALID_API_KEY", when: "Missing, unknown, expired or revoked key." }],
  },
  {
    id: "keys-create-customer",
    method: "POST",
    path: "/api/keys/customers",
    group: "keys",
    title: "Create a customer account",
    summary: "Platform key only. Creates an account that has NO password.",
    auth: "api-key",
    successStatus: 201,
    notes: [
      "**Platform keys only.**",
      "Writes into the SAME `users` collection as self-registration — there is no separate \"platform account\" type. The only differences are `authSource: \"platform\"` and **no password at all**.",
      "Because there is no password, that person signing in with one gets `409 NO_PASSWORD_SET` and is directed to `POST /api/auth/set-password/request`, which emails them a 6-digit code. From then on the account behaves exactly like any other.",
      "The account is created already **verified**: you supplied the address, so there is nothing for the customer to prove.",
      "`hasPassword` in the response is the field to check. It is derived from the stored hash, so it cannot drift.",
    ],
    params: [
      { name: "X-Api-Key", in: "header", type: "string", required: true, description: "A platform-scoped key." },
      { name: "name", in: "body", type: "string", required: true, description: "Display name, 1–80 characters.", example: "Ada Lovelace" },
      { name: "email", in: "body", type: "string", required: true, description: "Unique, lowercased. This is where the password-setup code will be sent.", example: "ada@company.com" },
      { name: "username", in: "body", type: "string", required: true, description: "3–32 chars, unique platform-wide.", example: "acme" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/keys/customers \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: $FASTAUTH_API_KEY" \\
  -d '{"name":"Ada Lovelace","email":"ada@company.com","username":"acme"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": {
    "user": { "id": "6abc…", "email": "ada@company.com", "username": "acme",
              "authSource": "platform", "emailVerified": true, "hasPassword": false },
    "passwordSet": false,
    "nextStep": "The account holder signs in with a social provider, or claims a password via POST /api/auth/set-password/request."
  }
}`,
    },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "Missing or malformed field." },
      { status: 401, code: "INVALID_API_KEY", when: "Missing, unknown, expired or revoked key." },
      { status: 403, code: "API_KEY_SCOPE_DENIED", when: "The key is scoped to a single application." },
      { status: 409, code: "EMAIL_TAKEN", when: "That email already has an account." },
      { status: 409, code: "USERNAME_TAKEN", when: "That username is already taken." },
    ],
  },
  {
    id: "keys-list-applications",
    method: "GET",
    path: "/api/keys/applications",
    group: "keys",
    title: "List every application",
    summary:
      "Platform key only. Returns all applications across all customers, newest first.",
    auth: "api-key",
    notes: [
      "**Platform keys only.** An app-scoped key receives `403 API_KEY_SCOPE_DENIED` — enumerating other tenants' applications is exactly what such a key must not be able to do.",
      "Use this to discover the `{appId}` the other endpoints in this section expect. It is the Mongo ObjectId, NOT the public `fa_...` id.",
      "The application secret is never returned — only a fingerprint of it.",
    ],
    params: [
      { name: "X-Api-Key", in: "header", type: "string", required: true, description: "A platform-scoped key." },
      { name: "page", in: "query", type: "number", required: false, description: "1-based page number. Default 1." },
      { name: "limit", in: "query", type: "number", required: false, description: "1–100. Default 25." },
      { name: "search", in: "query", type: "string", required: false, description: "Matches name, appId or description. Regex metacharacters are escaped." },
      { name: "status", in: "query", type: "string", required: false, description: "`active` or `suspended`." },
    ],
    requestExample: {
      lang: "bash",
      code: `curl "{{BASE_URL}}/api/keys/applications?search=game&limit=50" \\
  -H "X-Api-Key: $FASTAUTH_API_KEY"`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": {
    "applications": [{
      "id": "6abc…", "ownerId": "6def…", "name": "MyGame",
      "description": "", "appId": "fa_AbCdEfGhIjKlMnOp",
      "appSecretFingerprint": "x9", "status": "active",
      "createdAt": "…", "updatedAt": "…"
    }],
    "total": 1, "page": 1, "limit": 50, "totalPages": 1
  }
}`,
    },
  },
  {
    id: "keys-create-application",
    method: "POST",
    path: "/api/keys/applications",
    group: "keys",
    title: "Create an application",
    summary: "Platform key only. Creates an application owned by a given customer.",
    auth: "api-key",
    successStatus: 201,
    notes: [
      "**Platform keys only.**",
      "`ownerId` is REQUIRED: an application always belongs to a customer, so this route can never create one that belongs to nobody. Pass the customer's dashboard user id.",
      "The app secret is returned **exactly once**. It is hashed immediately and is unrecoverable — store it now.",
      "That customer's plan cap is still enforced. A platform key bypasses the cookie, never a business rule: exceeding the limit returns `403 APP_LIMIT_REACHED`.",
    ],
    params: [
      { name: "X-Api-Key", in: "header", type: "string", required: true, description: "A platform-scoped key." },
      { name: "ownerId", in: "body", type: "string", required: true, description: "ObjectId of the dashboard account that will own this application." },
      { name: "name", in: "body", type: "string", required: true, description: "Application name, 1–64 characters.", example: "MyGame" },
      { name: "description", in: "body", type: "string", required: false, description: "Up to 280 characters.", example: "Live game client" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/keys/applications \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: $FASTAUTH_API_KEY" \\
  -d '{"ownerId":"6def…","name":"MyGame","description":"Live client"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": { "application": {
    "id": "6abc…", "ownerId": "6def…", "name": "MyGame",
    "appId": "fa_AbCdEfGhIjKlMnOp",
    "appSecret": "fas_…",  "appSecretFingerprint": "x9",
    "status": "active", "createdAt": "…", "updatedAt": "…"
  } }
}`,
    },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "Missing fields, or `ownerId` names no customer." },
      { status: 401, code: "INVALID_API_KEY", when: "Missing, unknown, expired or revoked key." },
      { status: 403, code: "API_KEY_SCOPE_DENIED", when: "The key is scoped to a single application." },
      { status: 403, code: "APP_LIMIT_REACHED", when: "That customer is at their plan's application cap." },
    ],
  },
  {
    id: "keys-get-application",
    method: "GET",
    path: "/api/keys/applications/{appId}",
    group: "keys",
    title: "Read an application",
    summary: "Both key scopes. Returns one application the key is allowed to see.",
    auth: "api-key",
    notes: [
      "`{appId}` is the Mongo ObjectId from `GET /api/keys/applications`, not the public `fa_...` id.",
      "An app-scoped key presenting any other application's id gets `404` — the same response as an id that does not exist, so the API cannot be used to probe for valid ids.",
    ],
    params: [
      { name: "X-Api-Key", in: "header", type: "string", required: true, description: "Any valid key, platform or app-scoped." },
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
    ],
    requestExample: {
      lang: "bash",
      code: `curl {{BASE_URL}}/api/keys/applications/6abc… -H "X-Api-Key: $FASTAUTH_API_KEY"`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": { "application": {
    "id": "6abc…", "ownerId": "6def…", "name": "MyGame", "description": "",
    "appId": "fa_AbCdEfGhIjKlMnOp", "appSecretFingerprint": "x9",
    "status": "active", "createdAt": "…", "updatedAt": "…"
  } }
}`,
    },
  },
  {
    id: "keys-update-application",
    method: "PATCH",
    path: "/api/keys/applications/{appId}",
    group: "keys",
    title: "Edit an application",
    summary: "Both key scopes. Rename it or change its description.",
    auth: "api-key",
    notes: [
      "Only `name` and `description` are writable. The owner, the app id and the secret are NOT accepted here — a mass-assignment guard, not an omission.",
    ],
    params: [
      { name: "X-Api-Key", in: "header", type: "string", required: true, description: "Any valid key." },
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "name", in: "body", type: "string", required: false, description: "New name, 1–64 characters.", example: "MyGame v2" },
      { name: "description", in: "body", type: "string", required: false, description: "New description, up to 280 characters." },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X PATCH {{BASE_URL}}/api/keys/applications/6abc… \\
  -H "Content-Type: application/json" -H "X-Api-Key: $FASTAUTH_API_KEY" \\
  -d '{"name":"MyGame v2"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "application": { "id": "6abc…", "name": "MyGame v2", "…": "…" } } }`,
    },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "Empty body, or no field supplied." },
      { status: 401, code: "INVALID_API_KEY", when: "Missing, unknown, expired or revoked key." },
      { status: 404, code: "NOT_FOUND", when: "Not in this key's scope, or does not exist." },
    ],
  },
  {
    id: "keys-delete-application",
    method: "DELETE",
    path: "/api/keys/applications/{appId}",
    group: "keys",
    title: "Delete an application",
    summary: "Both key scopes. Cascades to its users, devices, sessions and logs.",
    auth: "api-key",
    notes: [
      "DESTRUCTIVE and irreversible. Every app user, device, session and audit log belonging to the application is deleted with it.",
      "Runs in a transaction when the deployment supports one, and orders the deletes children-first, so a mid-way failure leaves the application row intact and the call safely retryable.",
    ],
    params: [
      { name: "X-Api-Key", in: "header", type: "string", required: true, description: "Any valid key." },
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X DELETE {{BASE_URL}}/api/keys/applications/6abc… -H "X-Api-Key: $FASTAUTH_API_KEY"`,
    },
    responseExample: { lang: "json", code: `{ "success": true, "data": { "deleted": true } }` },
    errors: [
      { status: 401, code: "INVALID_API_KEY", when: "Missing, unknown, expired or revoked key." },
      { status: 404, code: "NOT_FOUND", when: "Not in this key's scope, or does not exist." },
    ],
  },
  {
    id: "keys-app-status",
    method: "PATCH",
    path: "/api/keys/applications/{appId}/status",
    group: "keys",
    title: "Start or stop an application",
    summary: "Both key scopes. Suspends or resumes all authentication for the app.",
    auth: "api-key",
    notes: [
      "While stopped, every `/api/v1` call is refused with `503 APP_SUSPENDED` — new logins **and** already-issued sessions.",
      "Reversible and non-destructive: nothing is deleted, so starting the app again restores service without every end user having to log in once more.",
      "Separate from the application PATCH because it cuts live traffic right now — it earns its own endpoint and its own audit entry instead of riding along with a rename.",
    ],
    params: [
      { name: "X-Api-Key", in: "header", type: "string", required: true, description: "Any valid key." },
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "status", in: "body", type: "string", required: true, description: "`active` or `suspended`.", example: "suspended" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X PATCH {{BASE_URL}}/api/keys/applications/6abc…/status \\
  -H "Content-Type: application/json" -H "X-Api-Key: $FASTAUTH_API_KEY" \\
  -d '{"status":"suspended"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "application": { "id": "6abc…", "status": "suspended", "…": "…" } } }`,
    },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "`status` is not `active` or `suspended`." },
      { status: 401, code: "INVALID_API_KEY", when: "Missing, unknown, expired or revoked key." },
      { status: 404, code: "NOT_FOUND", when: "Not in this key's scope, or does not exist." },
    ],
  },
  {
    id: "keys-app-stats",
    method: "GET",
    path: "/api/keys/applications/{appId}/stats",
    group: "keys",
    title: "Application statistics",
    summary: "Both key scopes. Users by state, devices, live sessions, 7-day success/failure split.",
    auth: "api-key",
    successStatus: 200,
    notes: [
      "Suitable for polling from a monitoring job.",
      "`active + banned + expired === total` by construction: banned users are excluded from the expired count, so the four numbers always reconcile.",
    ],
  },
  {
    id: "keys-app-logs",
    method: "GET",
    path: "/api/keys/applications/{appId}/logs",
    group: "keys",
    title: "Audit log",
    summary: "Both key scopes. Every authentication and management event, newest first.",
    auth: "api-key",
    successStatus: 200,
    notes: [
      "Records identifiers and outcomes only — never passwords, tokens or secret material.",
      "Filter with `action` (e.g. `LOGIN_FAILED`) and `search` (matches action, username, deviceId, ip, userAgent).",
    ],
  },
  {
    id: "keys-app-sessions",
    method: "GET",
    path: "/api/keys/applications/{appId}/sessions",
    group: "keys",
    title: "List live sessions",
    summary: "Both key scopes. Read-only — sessions are revoked per user or per device.",
    auth: "api-key",
    successStatus: 200,
    notes: [
      "Deliberately read-only: there is no \"delete session by id\" route, so a leaked key cannot quietly drop one user's session and nothing else. Revocation goes through `.../users/{userId}/revoke-sessions` or device removal, both audited.",
    ],
  },
  {
    id: "keys-list-users",
    method: "GET",
    path: "/api/keys/applications/{appId}/users",
    group: "keys",
    title: "List application users",
    summary: "Both key scopes. The end users of one application, newest first.",
    auth: "api-key",
    successStatus: 200,
    notes: [
      "`search` is anchored and escaped, so `jo` finds `john` and a term like `.*` is matched literally instead of sweeping the collection.",
      "Filter with `status`: `active`, `banned` or `expired`.",
    ],
  },
  {
    id: "keys-create-user",
    method: "POST",
    path: "/api/keys/applications/{appId}/users",
    group: "keys",
    title: "Create an application user",
    summary: "Both key scopes. Issues credentials for one licence.",
    auth: "api-key",
    successStatus: 201,
    notes: [
      "The same body the dashboard sends. The password you supply is hashed with bcrypt before storage and is never returned again.",
      "`expiresAt` is an absolute ISO-8601 instant, or `\"lifetime\"` / `null` for a licence that never expires. A day counter is deliberately not accepted: the server, not the client, decides what \"now\" means.",
    ],
    params: [
      { name: "X-Api-Key", in: "header", type: "string", required: true, description: "Any valid key." },
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "username", in: "body", type: "string", required: true, description: "Login handle, 3–32 chars. Unique within this application only.", example: "player123" },
      { name: "name", in: "body", type: "string", required: true, description: "Display name, 1–80 characters.", example: "Player One" },
      { name: "password", in: "body", type: "string", required: true, description: "8+ chars with upper case, lower case and a number.", example: "Secret123" },
      { name: "maxDevices", in: "body", type: "number", required: false, description: "Concurrent device seats, 1–100. Default 1." },
      { name: "expiresAt", in: "body", type: "string", required: false, description: "ISO-8601 instant, `\"lifetime\"`, or `null`." },
      { name: "notes", in: "body", type: "string", required: false, description: "Private note, up to 500 characters." },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/keys/applications/6abc…/users \\
  -H "Content-Type: application/json" -H "X-Api-Key: $FASTAUTH_API_KEY" \\
  -d '{"username":"player123","name":"Player One","password":"Secret123","maxDevices":2}'`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": { "user": {
    "id": "6ghi…", "username": "player123", "isBanned": false,
    "expiresAt": null, "maxDevices": 2, "…": "…"
  } }
}`,
    },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "Weak password, or a malformed field." },
      { status: 401, code: "INVALID_API_KEY", when: "Missing, unknown, expired or revoked key." },
      { status: 404, code: "NOT_FOUND", when: "Not in this key's scope, or does not exist." },
      { status: 409, code: "USERNAME_TAKEN", when: "That username already exists in this application." },
    ],
  },
  {
    id: "keys-get-user",
    method: "GET",
    path: "/api/keys/applications/{appId}/users/{userId}",
    group: "keys",
    title: "Read an application user",
    summary: "Both key scopes.",
    auth: "api-key",
    successStatus: 200,
  },
  {
    id: "keys-update-user",
    method: "PATCH",
    path: "/api/keys/applications/{appId}/users/{userId}",
    group: "keys",
    title: "Edit an application user",
    summary: "Both key scopes. Name, notes, device allowance, expiry or password.",
    auth: "api-key",
    notes: [
      "Supplying `password` revokes that user's live sessions in the same call, so a stolen session does not outlive the change.",
      "An explicit allow-list decides what is written, so `isBanned` and `passwordHash` cannot be set through this route — use the dedicated actions below.",
    ],
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "No field supplied, or a value breaks the policy." },
      { status: 401, code: "INVALID_API_KEY", when: "Missing, unknown, expired or revoked key." },
      { status: 404, code: "NOT_FOUND", when: "Not in this key's scope, or no such user." },
    ],
  },
  {
    id: "keys-delete-user",
    method: "DELETE",
    path: "/api/keys/applications/{appId}/users/{userId}",
    group: "keys",
    title: "Delete an application user",
    summary: "Both key scopes. Cascades to that user's devices and sessions.",
    auth: "api-key",
    notes: [
      "AuthLogs are deliberately RETAINED after the user row is gone — an audit trail must survive deletion of its subject, which is why `username` is denormalised onto each log.",
    ],
    responseExample: { lang: "json", code: `{ "success": true, "data": { "deleted": true } }` },
    errors: [
      { status: 401, code: "INVALID_API_KEY", when: "Missing, unknown, expired or revoked key." },
      { status: 404, code: "NOT_FOUND", when: "Not in this key's scope, or no such user." },
    ],
  },
  {
    id: "keys-ban-user",
    method: "POST",
    path: "/api/keys/applications/{appId}/users/{userId}/ban",
    group: "keys",
    title: "Ban a user",
    summary: "Both key scopes. Refuses login and kills live sessions by default.",
    auth: "api-key",
    notes: [
      "`revokeSessions` defaults to **true**: a ban that leaves live sessions running is trivially bypassed by a client that simply never re-authenticates.",
      "Banned users are refused with `403 ACCOUNT_BANNED` before any device seat is consumed.",
    ],
    errors: [
      { status: 401, code: "INVALID_API_KEY", when: "Missing, unknown, expired or revoked key." },
      { status: 404, code: "NOT_FOUND", when: "Not in this key's scope, or no such user." },
    ],
  },
  {
    id: "keys-extend-user",
    method: "POST",
    path: "/api/keys/applications/{appId}/users/{userId}/extend",
    group: "keys",
    title: "Extend a licence",
    summary: "Both key scopes. Adds days to the expiry.",
    auth: "api-key",
    notes: [
      "`from: \"now\"` starts a fresh period. `from: \"previous\"` continues from the current expiry — which is how an **already-expired** licence is restored for its full remaining term rather than only for the days that have not yet elapsed.",
    ],
    params: [
      { name: "X-Api-Key", in: "header", type: "string", required: true, description: "Any valid key." },
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "userId", in: "path", type: "string", required: true, description: "Application-user ObjectId." },
      { name: "days", in: "body", type: "number", required: true, description: "1–3650 days to add.", example: "30" },
      { name: "from", in: "body", type: "string", required: false, description: "`now` (default) or `previous`." },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/keys/applications/6abc…/users/6def…/extend \\
  -H "Content-Type: application/json" -H "X-Api-Key: $FASTAUTH_API_KEY" \\
  -d '{"days":30,"from":"previous"}'`,
    },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "`days` outside 1–3650." },
      { status: 401, code: "INVALID_API_KEY", when: "Missing, unknown, expired or revoked key." },
      { status: 404, code: "NOT_FOUND", when: "Not in this key's scope, or no such user." },
    ],
  },
  {
    id: "keys-reset-password",
    method: "POST",
    path: "/api/keys/applications/{appId}/users/{userId}/reset-password",
    group: "keys",
    title: "Reset a user's password",
    summary: "Both key scopes. Generates a new password server-side and returns it once.",
    auth: "api-key",
    notes: [
      "The plaintext is generated ON THE SERVER and returned **exactly once**. It is hashed immediately and is unrecoverable — treat the response as a one-time secret and never log it.",
      "All of that user's live sessions are revoked in the same call: a reset that leaves a stolen session running has not really reset anything.",
    ],
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": {
    "password": "Kx7#mQ2pLv",  "sessionsRevoked": 2,
    "user": { "id": "6def…", "username": "player123" }
  }
}`,
    },
    errors: [
      { status: 401, code: "INVALID_API_KEY", when: "Missing, unknown, expired or revoked key." },
      { status: 404, code: "NOT_FOUND", when: "Not in this key's scope, or no such user." },
    ],
  },
  {
    id: "keys-revoke-sessions",
    method: "POST",
    path: "/api/keys/applications/{appId}/users/{userId}/revoke-sessions",
    group: "keys",
    title: "Revoke all of a user's sessions",
    summary: "Both key scopes. Signs the user out on every device.",
    auth: "api-key",
    successStatus: 200,
    notes: [
      "Sessions are flagged rather than deleted, so the client receives `SESSION_REVOKED` — which it can act on — instead of a generic \"invalid token\" that reads as corruption.",
    ],
    responseExample: { lang: "json", code: `{ "success": true, "data": { "revoked": 2 } }` },
    errors: [
      { status: 401, code: "INVALID_API_KEY", when: "Missing, unknown, expired or revoked key." },
      { status: 404, code: "NOT_FOUND", when: "Not in this key's scope, or no such user." },
    ],
  },
  {
    id: "keys-reset-devices",
    method: "POST",
    path: "/api/keys/applications/{appId}/users/{userId}/reset-devices",
    group: "keys",
    title: "Reset a user's devices",
    summary: "Both key scopes. Frees every device seat.",
    auth: "api-key",
    notes: [
      "Sessions bound to those devices are revoked alongside: otherwise the user retains unlimited concurrent access through devices that are no longer supposed to exist.",
      "This is the support action for \"I reinstalled and lost my seats\".",
    ],
    responseExample: { lang: "json", code: `{ "success": true, "data": { "devicesRemoved": 2 } }` },
    errors: [
      { status: 401, code: "INVALID_API_KEY", when: "Missing, unknown, expired or revoked key." },
      { status: 404, code: "NOT_FOUND", when: "Not in this key's scope, or no such user." },
    ],
  },
  {
    id: "keys-list-devices",
    method: "GET",
    path: "/api/keys/applications/{appId}/devices",
    group: "keys",
    title: "List devices",
    summary: "Both key scopes. Every registered device in the application.",
    auth: "api-key",
    successStatus: 200,
    notes: [
      "Filter by `userId` to see one licence's seats, or `search` across device id, name, platform and last IP.",
      "Remember that `deviceId` is client-supplied: this is a seat-control mechanism, not tamper-proof hardware attestation.",
    ],
  },
  {
    id: "keys-update-device",
    method: "PATCH",
    path: "/api/keys/applications/{appId}/devices/{deviceId}",
    group: "keys",
    title: "Edit a device",
    summary: "Both key scopes. Change the display name and/or the client identifier.",
    auth: "api-key",
    notes: [
      "`{deviceId}` here is the device ROW's ObjectId, not the client-supplied identifier the game sends at login.",
      "Changing the `deviceId` is **not** free: a client still sending the old value registers as a NEW device and consumes another seat. Existing sessions are unaffected.",
      "The owning user is never read from the request body, so a device cannot be moved between users through this route.",
    ],
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "No fields supplied, or a value breaks the format rules." },
      { status: 401, code: "INVALID_API_KEY", when: "Missing, unknown, expired or revoked key." },
      { status: 404, code: "NOT_FOUND", when: "Not in this key's scope, or no such device." },
      { status: 409, code: "DUPLICATE", when: "That device id already belongs to another of the same user's devices." },
    ],
  },
  {
    id: "keys-delete-device",
    method: "DELETE",
    path: "/api/keys/applications/{appId}/devices/{deviceId}",
    group: "keys",
    title: "Remove a device",
    summary: "Both key scopes. Frees one seat and revokes its sessions.",
    auth: "api-key",
    notes: [
      "Sessions are flagged, not deleted, so clients see `SESSION_REVOKED` rather than a bare \"invalid token\".",
    ],
    responseExample: { lang: "json", code: `{ "success": true, "data": { "deleted": true } }` },
    errors: [
      { status: 401, code: "INVALID_API_KEY", when: "Missing, unknown, expired or revoked key." },
      { status: 404, code: "NOT_FOUND", when: "Not in this key's scope, or no such device." },
    ],
  },
  {
    id: "keys-rotate-secret",
    method: "POST",
    path: "/api/keys/applications/{appId}/rotate-secret",
    group: "keys",
    title: "Rotate the application secret",
    summary: "Both key scopes. Issues a new app secret and returns it once.",
    auth: "api-key",
    notes: [
      "BREAKING for live clients: any client still sending the previous secret stops working immediately. Rotate deliberately, not on a schedule.",
      "The new plaintext is returned **exactly once** and is unrecoverable afterwards.",
    ],
    params: [
      { name: "X-Api-Key", in: "header", type: "string", required: true, description: "Any valid key." },
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/keys/applications/6abc…/rotate-secret -H "X-Api-Key: $FASTAUTH_API_KEY"`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "application": { "id": "6abc…", "appSecret": "fas_…", "appSecretFingerprint": "x9" } } }`,
    },
    errors: [
      { status: 401, code: "INVALID_API_KEY", when: "Missing, unknown, expired or revoked key." },
      { status: 404, code: "NOT_FOUND", when: "Not in this key's scope, or does not exist." },
    ],
  },
  {
    id: "keys-unban-user",
    method: "POST",
    path: "/api/keys/applications/{appId}/users/{userId}/unban",
    group: "keys",
    title: "Lift a ban",
    summary: "Both key scopes. Restores access.",
    auth: "api-key",
    notes: [
      "`revokeSessions` defaults to **false** here, unlike ban: a routine unban should not sign the user out everywhere. Send `true` to also drop sessions issued while the ban was in force.",
    ],
    errors: [
      { status: 401, code: "INVALID_API_KEY", when: "Missing, unknown, expired or revoked key." },
      { status: 404, code: "NOT_FOUND", when: "Not in this key's scope, or no such user." },
    ],
  },
];
