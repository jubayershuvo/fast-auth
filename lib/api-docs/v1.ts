import type { EndpointDoc } from "./types";

/**
 * The PUBLIC API — what a developer calls from inside their game, desktop app
 * or launcher. Everything here authenticates an END USER, never the customer.
 */
export const V1_ENDPOINTS: EndpointDoc[] = [
  {
    id: "v1-login",
    method: "POST",
    path: "/api/v1/auth/login",
    group: "v1",
    title: "Log in an end user",
    summary:
      "Exchange an end user's credentials and a device id for a session token.",
    auth: "none",
    notes: [
      "The `sessionToken` is returned exactly once. Store it server-side; it is never retrievable again.",
      "The first login on a device registers that device against the user's seat allowance. Later logins on the same `deviceId` do not consume another seat.",
      "A user may hold at most `MAX_SESSIONS_PER_USER` live sessions (20 by default). Beyond that, login returns `429 TOO_MANY_SESSIONS`; the user should sign out on another device first, or call `POST /api/v1/auth/sessions/revoke-others`.",
      "Returns `503 APP_SUSPENDED` while the owner has stopped the application, so no player can sign in at all.",
      "Failed attempts are still written to the application's audit log, so the owner can see them.",
      "The application id travels in the `X-App-Id` **header**, not the body. It used to be accepted in the body, but a single source for the app scope means the id can never disagree with the credentials beside it.",
    ],
    params: [
      {
        name: "X-App-Id",
        in: "header",
        type: "string",
        required: true,
        description: "Your application id, shown once when the application is created.",
        example: "fa_AbCdEfGhIjKlMnOp",
      },
      {
        name: "username",
        in: "body",
        type: "string",
        required: true,
        description: "The end user's username. Up to 254 characters, any characters except control codes. **Not** restricted to letters/digits/underscores — an end user may be a Steam ID, an email, a UUID or any opaque token your backend issues. Case-insensitive.",
        example: "player123",
      },
      {
        name: "password",
        in: "body",
        type: "string",
        required: true,
        description: "The end user's password. Any characters, at least 1, at most 72 **bytes**. No character-class rules.",
        example: "x",
      },
      {
        name: "deviceId",
        in: "body",
        type: "string",
        required: true,
        description:
          "A stable per-installation identifier (8–128 chars). Send the SAME value for a given machine, e.g. a generated HWID.",
        example: "device-8f2a91c4",
      },
      {
        name: "appSecret",
        in: "body",
        type: "string",
        required: false,
        description:
          "Your application secret. Optional, but recommended: it makes the app-level credential a second factor.",
        example: "fas_...",
      },
      {
        name: "deviceName",
        in: "body",
        type: "string",
        required: false,
        description:
          "Friendly label (1–80 chars) shown in the owner's device list. Applied **only when the device is registered for the first time** — later logins keep whatever name the owner set, so a client cannot rename a device or wipe a label just by logging in again. Send an empty string for no name.",
        example: "Alice's PC",
      },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/v1/auth/login \\
  -H "Content-Type: application/json" \\
  -H "X-App-Id: fa_AbCdEfGhIjKlMnOp" \\
  -d '{
    "username":  "player123",
    "password":  "Secret123",
    "deviceId":  "device-8f2a91c4"
  }'`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": {
    "sessionToken": "bXk9…",
    "expiresAt": "2026-11-29T12:00:00.000Z",
    "user": {
      "username": "player123",
      "deviceId": "device-8f2a91c4",
      "devicesUsed": 1,
      "maxDevices": 2,
      "isNewDevice": true
    }
  }
}`,
    },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "The `X-App-Id` header is missing or malformed." },
      { status: 404, code: "INVALID_APPLICATION", when: "The `X-App-Id` header names an unknown application." },
      { status: 401, code: "INVALID_APP_SECRET", when: "`appSecret` does not match." },
      { status: 401, code: "INVALID_CREDENTIALS", when: "Username or password is wrong." },
      { status: 403, code: "ACCOUNT_BANNED", when: "The owner has banned this user." },
      { status: 403, code: "ACCOUNT_EXPIRED", when: "The licence expiry has passed." },
      { status: 403, code: "DEVICE_LIMIT_REACHED", when: "All device seats are in use." },
      { status: 429, code: "RATE_LIMITED", when: "Too many attempts for this appId + ip + username." },
    ],
  },
  {
    id: "v1-validate",
    method: "GET",
    path: "/api/v1/auth/validate",
    group: "v1",
    title: "Validate a session",
    summary: "Check whether a session token is still usable. Call this on every protected request.",
    auth: "bearer",
    notes: [
      "Failure is always a 401/403 status, never a 200 with a false body — so a single `if (!res.ok)` is enough.",
    ],
    params: [
      {
        name: "Authorization",
        in: "header",
        type: "string",
        required: true,
        description: "`Bearer <sessionToken>`",
        example: "Bearer bXk9…",
      },
      {
        name: "X-App-Id",
        in: "header",
        type: "string",
        required: true,
        description: "Enforce that the token was issued for this application.",
        example: "fa_AbCdEfGhIjKlMnOp",
      },
      {
        name: "deviceId",
        in: "query",
        type: "string",
        required: false,
        description: "Enforce that the token was issued to this exact device.",
        example: "device-8f2a91c4",
      },
    ],
    requestExample: {
      lang: "bash",
      code: `curl "{{BASE_URL}}/api/v1/auth/validate?deviceId=device-8f2a91c4" \\
  -H "Authorization: Bearer bXk9…" \\
  -H "X-App-Id: fa_AbCdEfGhIjKlMnOp"`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": {
    "valid": true,
    "username": "player123",
    "deviceId": "device-8f2a91c4",
    "expiresAt": "2026-11-29T12:00:00.000Z"
  }
}`,
    },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "The `X-App-Id` header is missing or malformed." },
      { status: 401, code: "UNAUTHORIZED", when: "No `Authorization: Bearer` header." },
      { status: 401, code: "SESSION_EXPIRED", when: "The token has passed `expiresAt`." },
      { status: 401, code: "SESSION_REVOKED", when: "The owner revoked the session." },
      { status: 403, code: "DEVICE_MISMATCH", when: "`deviceId` does not match the token." },
    ],
  },
  {
    id: "v1-me",
    method: "GET",
    path: "/api/v1/auth/me",
    group: "v1",
    title: "Who am I",
    summary: "Return the identity bound to the presented session token.",
    auth: "bearer",
    params: [
      {
        name: "Authorization",
        in: "header",
        type: "string",
        required: true,
        description: "`Bearer <sessionToken>`",
        example: "Bearer bXk9…",
      },
      {
        name: "X-App-Id",
        in: "header",
        type: "string",
        required: true,
        description: "The application the token belongs to.",
        example: "fa_AbCdEfGhIjKlMnOp",
      },
    ],
    requestExample: {
      lang: "bash",
      code: `curl {{BASE_URL}}/api/v1/auth/me \\
  -H "Authorization: Bearer bXk9…" \\
  -H "X-App-Id: fa_AbCdEfGhIjKlMnOp"`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": {
    "valid": true,
    "username": "player123",
    "deviceId": "device-8f2a91c4",
    "expiresAt": "2026-11-29T12:00:00.000Z"
  }
}`,
    },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "The `X-App-Id` header is missing or malformed." },
      { status: 401, code: "UNAUTHORIZED", when: "Missing, expired or revoked token." },
    ],
  },
  {
    id: "v1-logout",
    method: "POST",
    path: "/api/v1/auth/logout",
    group: "v1",
    title: "Log out",
    summary: "Revoke ONLY the presented session. Idempotent.",
    auth: "bearer",
    notes: [
      "This does not free a device seat. The owner frees seats with the dashboard's **Reset devices** action.",
      "Takes no body. The `X-App-Id` header is optional here — omitting it still revokes the token.",
    ],
    params: [
      {
        name: "Authorization",
        in: "header",
        type: "string",
        required: true,
        description: "`Bearer <sessionToken>`",
        example: "Bearer bXk9…",
      },
      {
        name: "X-App-Id",
        in: "header",
        type: "string",
        required: false,
        description: "Optional. Restricts the revoke to this application.",
        example: "fa_AbCdEfGhIjKlMnOp",
      },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/v1/auth/logout \\
  -H "Authorization: Bearer bXk9…" \\
  -H "X-App-Id: fa_AbCdEfGhIjKlMnOp"`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "loggedOut": true } }`,
    },
    errors: [{ status: 401, code: "UNAUTHORIZED", when: "No bearer token supplied." }],
  },
  {
    id: "v1-refresh",
    method: "POST",
    path: "/api/v1/auth/refresh",
    group: "v1",
    title: "Refresh a session",
    summary: "Extend the caller's session before it expires. Takes no body.",
    auth: "bearer",
    notes: [
      "The token is returned **unchanged** — there is nothing new to store. Call this shortly before `expiresAt` to keep an active player signed in.",
      "Sliding window, clamped to `createdAt + APP_SESSION_MAX_LIFETIME_DAYS` (90 days by default). A session cannot be renewed past that ceiling, so a stolen token cannot be kept alive forever by renewing in a loop.",
      "An **expired** session is rejected, not revived. Renewing a dead session would turn any leaked historical token into a permanent credential.",
      "Refuses with `503 APP_SUSPENDED` while the application is stopped, so Stop cannot be bypassed by renewing.",
      "The token is not rotated. Rotation would force every client to swap credentials atomically, and a client failing halfway would be locked out.",
    ],
    params: [
      {
        name: "Authorization",
        in: "header",
        type: "string",
        required: true,
        description: "`Bearer <sessionToken>`",
        example: "Bearer bXk9…",
      },
      {
        name: "X-App-Id",
        in: "header",
        type: "string",
        required: true,
        description: "Your application id.",
        example: "fa_AbCdEfGhIjKlMnOp",
      },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/v1/auth/refresh \\
  -H "Authorization: Bearer bXk9…" \\
  -H "X-App-Id: fa_AbCdEfGhIjKlMnOp"`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": { "expiresAt": "2026-12-29T12:00:00.000Z" }
}`,
    },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "The `X-App-Id` header is missing or malformed." },
      { status: 401, code: "UNAUTHORIZED", when: "No bearer token, or it is not one of ours." },
      { status: 401, code: "SESSION_EXPIRED", when: "The session has already expired and cannot be revived." },
      { status: 401, code: "SESSION_REVOKED", when: "Revoked by logout, a ban or device removal." },
      { status: 503, code: "APP_SUSPENDED", when: "The application owner has stopped this application." },
    ],
  },
  {
    id: "v1-change-password",
    method: "POST",
    path: "/api/v1/auth/password",
    group: "v1",
    title: "Change your own password",
    summary: "Self-service password change for an end user.",
    auth: "bearer",
    notes: [
      "Requires the **current** password even though the caller already holds a valid session. That step-up check is what stops a stolen session from taking the account over permanently.",
      "Every OTHER session for the user is revoked, so a stolen token dies the moment the real user changes their password. The session making the request stays valid — you are not logged out of the call you just made.",
      "End-user credentials are deliberately permissive: the format is your product's business, not ours. A hardware-generated HWID, a single character or an opaque token are all valid. The only rules are that neither value may be empty and both must fit bcrypt's 72-byte limit (bytes, not characters — 30 emoji would exceed it).",
    ],
    params: [
      { name: "Authorization", in: "header", type: "string", required: true, description: "`Bearer <sessionToken>`", example: "Bearer bXk9…" },
      { name: "X-App-Id", in: "header", type: "string", required: true, description: "Your application id.", example: "fa_AbCdEfGhIjKlMnOp" },
      { name: "currentPassword", in: "body", type: "string", required: true, description: "The password currently in force. This is the step-up check.", example: "Secret123" },
      { name: "newPassword", in: "body", type: "string", required: true, description: "The replacement. Must satisfy the account password policy and differ from the current one.", example: "NewSecret456" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/v1/auth/password \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer bXk9…" \\
  -H "X-App-Id: fa_AbCdEfGhIjKlMnOp" \\
  -d '{
    "currentPassword": "Secret123",
    "newPassword":   "NewSecret456"
  }'`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": { "revokedSessions": 2 }
}`,
    },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "The new password fails the password policy." },
      { status: 400, code: "PASSWORD_UNCHANGED", when: "The new password equals the current one." },
      { status: 401, code: "UNAUTHORIZED", when: "No bearer token supplied." },
      { status: 401, code: "CURRENT_PASSWORD_INCORRECT", when: "`currentPassword` does not match." },
      { status: 503, code: "APP_SUSPENDED", when: "The application owner has stopped this application." },
    ],
  },
  {
    id: "v1-list-sessions",
    method: "GET",
    path: "/api/v1/auth/sessions",
    group: "v1",
    title: "List your sessions",
    summary: "Where this account is currently signed in. Most recently used first.",
    auth: "bearer",
    notes: [
      "Always scoped to the **caller's own** sessions — there is no `userId` parameter, so this endpoint cannot be pointed at another account.",
      "Only live sessions are returned; expired and revoked ones are filtered out.",
      "Pair with **Revoke your other sessions** to respond to \"someone else has my account\".",
    ],
    params: [
      { name: "Authorization", in: "header", type: "string", required: true, description: "`Bearer <sessionToken>`", example: "Bearer bXk9…" },
      { name: "X-App-Id", in: "header", type: "string", required: true, description: "Your application id.", example: "fa_AbCdEfGhIjKlMnOp" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl {{BASE_URL}}/api/v1/auth/sessions \\
  -H "Authorization: Bearer bXk9…" \\
  -H "X-App-Id: fa_AbCdEfGhIjKlMnOp"`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": {
    "currentSessionId": "6abc…",
    "sessions": [
      {
        "id": "6abc…",
        "deviceId": "device-8f2a91c4",
        "createdAt": "2026-10-01T09:00:00.000Z",
        "expiresAt": "2026-10-31T09:00:00.000Z",
        "lastUsedAt": "2026-10-20T18:00:00.000Z",
        "ip": "203.0.113.9",
        "isActive": true
      }
    ]
  }
}`,
    },
    errors: [
      { status: 401, code: "UNAUTHORIZED", when: "No bearer token supplied." },
      { status: 503, code: "APP_SUSPENDED", when: "The application owner has stopped this application." },
    ],
  },
  {
    id: "v1-revoke-others",
    method: "POST",
    path: "/api/v1/auth/sessions/revoke-others",
    group: "v1",
    title: "Revoke your other sessions",
    summary: "Sign out every other device for this account, keeping the current one.",
    auth: "bearer",
    notes: [
      "The caller's own session deliberately **survives**. Revoking it would log you out of the very request you sent, which reads as a random failure.",
      "Revocations are flagged rather than deleted, so those clients receive `SESSION_REVOKED` — a signal they can act on — instead of a generic invalid-token error.",
    ],
    params: [
      { name: "Authorization", in: "header", type: "string", required: true, description: "`Bearer <sessionToken>`", example: "Bearer bXk9…" },
      { name: "X-App-Id", in: "header", type: "string", required: true, description: "Your application id.", example: "fa_AbCdEfGhIjKlMnOp" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/v1/auth/sessions/revoke-others \\
  -H "Authorization: Bearer bXk9…" \\
  -H "X-App-Id: fa_AbCdEfGhIjKlMnOp"`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "revoked": 2 } }`,
    },
    errors: [
      { status: 401, code: "UNAUTHORIZED", when: "No bearer token supplied." },
      { status: 401, code: "SESSION_EXPIRED", when: "Your own session has already expired." },
      { status: 503, code: "APP_SUSPENDED", when: "The application owner has stopped this application." },
    ],
  },
];
