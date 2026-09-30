import type { EndpointDoc } from "./types";

/**
 * The self-service portal API.
 *
 * A FIFTH realm, distinct from the four around it. These endpoints serve the
 * person who signs in at `/portal` to look after their own account — their
 * expiry date, their password, their devices. They are NOT for the customer's
 * backend, which uses the v1 API with a bearer token, and they are NOT for the
 * dashboard owner, who uses the Dashboard API.
 *
 * Auth is the httpOnly `fa_app_session` cookie. Every route here except the
 * sign-in one scopes itself to the account in that session: there is no user-id
 * path parameter anywhere in this file, so none of these endpoints can be
 * pointed at somebody else's account.
 *
 * The pages behind these endpoints are `/apps/<appId>/login` and
 * `/apps/<appId>/dashboard`. A session belongs to ONE application: it cannot open
 * another application's dashboard, even from the same browser.
 */
export const PORTAL_ENDPOINTS: EndpointDoc[] = [
  {
    id: "portal-login",
    method: "POST",
    path: "/api/portal/auth/login",
    group: "portal",
    title: "Sign in to the portal",
    summary: "Sign one of your application's end users in from a browser.",
    auth: "none",
    notes: [
      "`appId` is the PUBLIC `fa_…` id and is required. An end-user username is only unique WITHIN an application — `player1` is a different account in every app — so there is nothing to sign in to without saying which application this is.",
      "**No `appSecret`.** That is your backend's second factor; asking a person for it here would hand the application-wide secret to every end user who signs in.",
      "Username and password use the permissive end-user rules, not the dashboard policy.",
      "Issues an httpOnly `fa_app_session` cookie. It does **not** register a device, so visiting the portal never consumes one of your licence seats.",
      "The page that calls this is `/apps/<appId>/login`, and it lands on `/apps/<appId>/dashboard`. `appId` is in the URL there, so the sign-in form asks for a username and password alone.",
      "Refused with the same codes as `POST /api/v1/auth/login` — `ACCOUNT_BANNED`, `ACCOUNT_EXPIRED`, `APP_SUSPENDED` — so a browser is locked out exactly when the game client would be.",
    ],
    params: [
      { name: "appId", in: "body", type: "string", required: true, description: "The public application id.", example: "fa_AbCdEfGhIjKlMnOp" },
      { name: "username", in: "body", type: "string", required: true, description: "The end user's username. Any characters except control codes; case-insensitive.", example: "player1" },
      { name: "password", in: "body", type: "string", required: true, description: "The end user's password. Any characters, 1–72 bytes.", example: "x" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/portal/auth/login -c cookies.txt \\
  -H "Content-Type: application/json" \\
  -d '{"appId":"fa_AbCdEfGhIjKlMnOp","username":"player1","password":"x"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": {
  "user": { "id": "6abc…", "username": "player1", "name": "Player One" },
  "applicationName": "My Game",
  "expiresAt": "2026-11-30T12:00:00.000Z"
} }`,
    },
    errors: [
      { status: 401, code: "INVALID_CREDENTIALS", when: "Wrong username or password. Identical for both, and for an unknown username." },
      { status: 403, code: "ACCOUNT_BANNED", when: "The owner suspended this account." },
      { status: 403, code: "ACCOUNT_EXPIRED", when: "The account's expiry has passed." },
      { status: 403, code: "APP_SUSPENDED", when: "The owner pressed Stop on the whole application." },
      { status: 404, code: "INVALID_APPLICATION", when: "No application with that `appId`." },
      { status: 429, code: "RATE_LIMITED", when: "Too many attempts for this app + IP + username." },
    ],
  },
  {
    id: "portal-me",
    method: "GET",
    path: "/api/portal/me",
    group: "portal",
    title: "Your own account",
    summary: "Read the signed-in end user's profile, expiry date and seat usage.",
    auth: "portal-cookie",
    notes: [
      "Scoped entirely to the cookie's session. There is no id in the path, so this cannot be pointed at another account.",
      "`expiresAt` is `null` for a lifetime account. `isExpired` is always `false` for a session that is currently valid — an expired account cannot hold one at all, because the session resolver refuses it.",
      "`notes` is always `null`. It is your private remark about this customer, and the account holder is not entitled to read it.",
      "`devicesUsed` counts real client devices only. The portal session itself is not a device and never consumes a seat.",
    ],
    params: [],
    requestExample: {
      lang: "bash",
      code: `curl {{BASE_URL}}/api/portal/me -b cookies.txt`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "user": {
  "id": "6abc…", "username": "player1", "name": "Player One",
  "applicationId": "6def…", "applicationName": "My Game",
  "expiresAt": "2026-11-30T12:00:00.000Z", "isExpired": false,
  "devicesUsed": 1, "maxDevices": 2,
  "lastLoginAt": "2026-10-30T09:00:00.000Z",
  "createdAt": "2026-01-04T11:20:00.000Z",
  "notes": null
} } }`,
    },
    errors: [
      { status: 401, code: "UNAUTHORIZED", when: "No portal session, or it has expired, been revoked, or the account was banned or expired since." },
    ],
  },
  {
    id: "portal-me-update",
    method: "PATCH",
    path: "/api/portal/me",
    group: "portal",
    title: "Update your own details",
    summary: "Change the one field an end user owns — their display name.",
    auth: "portal-cookie",
    notes: [
      "Accepts `name` and nothing else. `username` is the login handle and is immutable here; ban, expiry, device limit and notes are YOUR controls, and they are absent from the accepted shape rather than merely unchecked.",
      "No id in the body, so the target is always the session's own account.",
    ],
    params: [
      { name: "name", in: "body", type: "string", required: true, description: "Display name. 1–80 characters; control characters are stripped.", example: "Player One" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X PATCH {{BASE_URL}}/api/portal/me -b cookies.txt \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Player One"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "user": { "name": "Player One" } } }`,
    },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "The name was empty or longer than 80 characters." },
      { status: 401, code: "UNAUTHORIZED", when: "No valid portal session." },
    ],
  },
  {
    id: "portal-password",
    method: "POST",
    path: "/api/portal/password",
    group: "portal",
    title: "Change your own password",
    summary: "Rotate the end user's password from the portal.",
    auth: "portal-cookie",
    notes: [
      "`currentPassword` is required even though the caller already holds a valid session. That step-up check is the point: without it, a stolen portal cookie would let an attacker rotate the password and lock the real owner out permanently.",
      "**Every other session is revoked** — their game clients and any other browsers — so a stolen session dies the moment the owner rotates. The session making this request stays valid, so nobody is logged out of the page they are on.",
      "Uses the permissive end-user password rules, not the dashboard policy.",
    ],
    params: [
      { name: "currentPassword", in: "body", type: "string", required: true, description: "The password currently in force.", example: "old-secret" },
      { name: "newPassword", in: "body", type: "string", required: true, description: "The replacement. 1–72 bytes, any characters, and different from the current one.", example: "new-secret" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/portal/password -b cookies.txt \\
  -H "Content-Type: application/json" \\
  -d '{"currentPassword":"old-secret","newPassword":"new-secret"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "updated": true } }`,
    },
    errors: [
      { status: 400, code: "PASSWORD_UNCHANGED", when: "The new password matches the current one." },
      { status: 401, code: "CURRENT_PASSWORD_INCORRECT", when: "`currentPassword` did not match." },
      { status: 401, code: "UNAUTHORIZED", when: "No valid portal session." },
    ],
  },
  {
    id: "portal-devices",
    method: "GET",
    path: "/api/portal/devices",
    group: "portal",
    title: "Your own devices",
    summary: "List the signed-in end user's registered devices, most recently active first.",
    auth: "portal-cookie",
    notes: [
      "Scoped by the session's user AND application. The portal session itself never appears here: it is not a device row, because a browser must never consume a licence seat.",
      "**`canDelete` is computed server-side**, from the same rule the DELETE endpoint enforces, so the button a person sees and the rule that actually applies cannot disagree. The client is never asked to decide.",
      "`idleMinutes` is the configured quiet period. Set `PORTAL_DEVICE_IDLE_MINUTES=0` to remove the rule entirely.",
    ],
    params: [],
    requestExample: {
      lang: "bash",
      code: `curl {{BASE_URL}}/api/portal/devices -b cookies.txt`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": {
  "idleMinutes": 60,
  "devices": [
    { "id": "6aaa…", "deviceId": "hwid-abc-123", "deviceName": "Alice's PC",
      "firstSeenAt": "2026-01-04T11:20:00.000Z",
      "lastSeenAt": "2026-10-29T18:00:00.000Z",
      "lastIp": "203.0.113.7", "platform": "Windows",
      "canDelete": true, "idleMs": 99000000 }
  ]
} }`,
    },
    errors: [
      { status: 401, code: "UNAUTHORIZED", when: "No valid portal session." },
    ],
  },
  {
    id: "portal-device-delete",
    method: "DELETE",
    path: "/api/portal/devices/{deviceId}",
    group: "portal",
    title: "Remove one of your devices",
    summary: "Free a licence seat by removing a device that has been idle long enough.",
    auth: "portal-cookie",
    notes: [
      "**The idle rule.** A device must have been inactive for `PORTAL_DEVICE_IDLE_MINUTES` (default 60) before it can be removed. Freeing a seat is a privilege, and with no delay an account could churn through seats at will — or delete the device it is currently using and be signed out mid-request. Requiring a quiet period is also exactly when a person wants this: a device abandoned last week, not the one under their hands. Set the variable to `0` to disable the rule.",
      "Too recent is refused with `409 DEVICE_STILL_ACTIVE` — its own code, because the remedy is TIME rather than permission. A generic 403 would read as \"you are not allowed\" and send the user to your support for something that resolves itself.",
      "Sessions issued on that device are revoked with it, so the holder cannot keep authenticating from a device that no longer exists.",
      "Scoped to the session's own user and application, so another user's or another tenant's device id simply does not match.",
    ],
    params: [
      { name: "deviceId", in: "path", type: "string", required: true, description: "The device document id from `GET /api/portal/devices`.", example: "6aaa1b2c3d4e5f6a7b8c9d0e" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X DELETE {{BASE_URL}}/api/portal/devices/6aaa1b2c3d4e5f6a7b8c9d0e -b cookies.txt`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "deleted": true } }`,
    },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "`deviceId` is not a 24-character object id." },
      { status: 401, code: "UNAUTHORIZED", when: "No valid portal session." },
      { status: 404, code: "NOT_FOUND", when: "No such device belongs to this account. Also the answer for another user's or another tenant's device." },
      { status: 409, code: "DEVICE_STILL_ACTIVE", when: "The device was active within the idle window; try again once it passes." },
    ],
  },
  {
    id: "portal-logout",
    method: "POST",
    path: "/api/portal/auth/logout",
    group: "portal",
    title: "Sign out",
    summary: "Revoke this browser's portal session and clear the cookie.",
    auth: "portal-cookie",
    notes: [
      "Idempotent: signing out twice, or without a session, is a success.",
      "Only THIS browser is signed out. Their game clients and any other browsers are untouched — that is what the owner's \"revoke sessions\" control is for.",
    ],
    params: [],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/portal/auth/logout -b cookies.txt`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "signedOut": true } }`,
    },
    errors: [],
  },
];