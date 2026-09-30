import type { EndpointDoc } from "./types";

/**
 * The DASHBOARD API — customer-facing, authenticated with the httpOnly
 * `fa_session` cookie. These are the same endpoints the FastAuth dashboard UI
 * calls, so you can script them from your own backend.
 *
 * Tenancy: every `{appId}` is resolved against the OWNER IN THE SESSION, never
 * a client-supplied owner. A valid id belonging to another account returns
 * `404`, never someone else's data.
 */
export const DASHBOARD_ENDPOINTS: EndpointDoc[] = [
  // ── Account ────────────────────────────────────────────────────────────
  {
    id: "dash-register",
    method: "POST",
    path: "/api/auth/register",
    group: "dashboard",
    title: "Create a dashboard account",
    summary: "Register a customer account and email them a 6-digit verification code.",
    auth: "none",
    successStatus: 201,
    notes: [
      "**No session is issued.** The account is created UNVERIFIED and cannot be used until the code is entered via `POST /api/auth/verify-email`. This is what stops somebody registering with an address they do not own and then receiving password-reset mail for a victim account.",
      "The password IS hashed and stored at this point, so the account is never locked out if the email fails to send — the user can simply request another code.",
      "The code is returned by neither this call nor any other. The only copy goes to the inbox.",
      "The dashboard UI handles both steps for you; this is the raw API for scripted signup.",
    ],
    params: [
      { name: "name", in: "body", type: "string", required: true, description: "Display name, 1–80 chars. Spaces, punctuation and non-Latin scripts are allowed.", example: "Ada Lovelace" },
      { name: "email", in: "body", type: "string", required: true, description: "Unique, lowercased. The verification code is sent here.", example: "you@company.com" },
      { name: "username", in: "body", type: "string", required: true, description: "3–32 chars, unique platform-wide.", example: "acme" },
      {
        name: "password",
        in: "body",
        type: "string",
        required: true,
        description: "8+ chars with upper case, lower case and a number.",
        example: "Owner123",
      },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/auth/register \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Ada Lovelace","email":"you@company.com","username":"acme","password":"Owner123"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": {
    "user": { "id": "6abc…", "email": "you@company.com", "username": "acme",
              "authSource": "self", "emailVerified": false, "hasPassword": true },
    "verificationRequired": true
  }
}`,
    },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "Weak password or malformed field." },
      { status: 409, code: "EMAIL_TAKEN", when: "Email already registered." },
      { status: 409, code: "USERNAME_TAKEN", when: "Username already taken." },
      { status: 429, code: "RATE_LIMITED", when: "Too many signup attempts from this IP." },
      { status: 503, code: "EMAIL_DELIVERY_FAILED", when: "The code could not be sent. Retry." },
    ],
  },
  {
    id: "dash-verify-email",
    method: "POST",
    path: "/api/auth/verify-email",
    group: "dashboard",
    title: "Verify an email address",
    summary: "Confirm the emailed 6-digit code, then sign in.",
    auth: "none",
    notes: [
      "Verifying and signing in are ONE call on purpose. Splitting them would let an attacker who intercepted the code verify the account and then sit waiting for the real owner to type a password.",
      "The code is single-use and expires in `EMAIL_CODE_TTL_MINUTES` (15 by default). Requesting a new one invalidates the previous.",
      "Already-verified accounts succeed idempotently, so re-entering a code after a resend is not an error.",
    ],
    params: [
      { name: "email", in: "body", type: "string", required: true, description: "The address the code was sent to.", example: "you@company.com" },
      { name: "code", in: "body", type: "string", required: true, description: "The 6-digit code from the email.", example: "481902" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/auth/verify-email \\
  -H "Content-Type: application/json" -c cookies.txt \\
  -d '{"email":"you@company.com","code":"481902"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": { "user": { "id": "6abc…", "email": "you@company.com",
                       "emailVerified": true, "hasPassword": true } }
}`,
    },
    errors: [
      { status: 400, code: "INVALID_VERIFICATION_CODE", when: "Wrong code, or none was ever issued." },
      { status: 400, code: "VERIFICATION_CODE_EXPIRED", when: "The code was correct but has timed out." },
      { status: 429, code: "TOO_MANY_CODE_ATTEMPTS", when: "Too many wrong codes; the code was destroyed." },
    ],
  },
  {
    id: "dash-resend-verification",
    method: "POST",
    path: "/api/auth/resend-verification",
    group: "dashboard",
    title: "Resend the verification code",
    summary: "Email a fresh 6-digit code to an unverified account.",
    auth: "none",
    notes: [
      "The response is IDENTICAL for an unknown address and an already-verified one, so this cannot be used to discover who is registered.",
      "Rate limited per address, not per IP, so a shared office IP cannot lock out one person.",
    ],
    params: [
      { name: "email", in: "body", type: "string", required: true, description: "The address awaiting verification.", example: "you@company.com" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/auth/resend-verification \\
  -H "Content-Type: application/json" \\
  -d '{"email":"you@company.com"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": {
  "sent": true,
  "message": "If that address is awaiting verification, a new code is on its way."
} }`,
    },
    errors: [
      { status: 429, code: "RATE_LIMITED", when: "Too many codes requested for this address." },
      { status: 503, code: "EMAIL_DELIVERY_FAILED", when: "The code could not be sent." },
    ],
  },
  {
    id: "dash-request-password",
    method: "POST",
    path: "/api/auth/set-password/request",
    group: "dashboard",
    title: "Request a password-setup code",
    summary: "Email a code to an account that has no password, so one can be claimed.",
    auth: "none",
    notes: [
      "This is the path for an account created by an operator (`POST /api/keys/customers`) or through social sign-in. Both exist in the same `users` collection with `passwordHash: null`.",
      "Only accounts with NO password qualify. A request for an account that already has one is a password-RESET attempt, and treating it as a setup would let anyone who knows an address overwrite a working credential by \"claiming\" it. Such a request is silently ignored.",
      "The response is identical for an unknown address, an address that already has a password, and a real one.",
    ],
    params: [
      { name: "email", in: "body", type: "string", required: true, description: "The address on the account.", example: "you@company.com" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/auth/set-password/request \\
  -H "Content-Type: application/json" \\
  -d '{"email":"you@company.com"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": {
  "sent": true,
  "message": "If that account has no password, a 6-digit code is on its way."
} }`,
    },
    errors: [
      { status: 429, code: "RATE_LIMITED", when: "Too many codes requested for this address." },
      { status: 503, code: "EMAIL_DELIVERY_FAILED", when: "The code could not be sent." },
    ],
  },
  {
    id: "dash-forgot-password",
    method: "POST",
    path: "/api/auth/forgot-password",
    group: "dashboard",
    title: "Request a password-reset code",
    summary: "Email a code that lets the owner choose a new password — works whether or not one already exists.",
    auth: "none",
    notes: [
      "**Handles both cases in one call.** If the account already has a password it is REPLACED; if it never had one, this writes the first. The two situations are indistinguishable to the caller, which is the point: from the sign-in screen, \"I forgot my password\" and \"I never had one\" are the same problem.",
      "Requesting a code changes NOTHING and proves nothing on its own — only someone who can actually read the mailbox can spend the code at the next step. An attacker who merely knows an address triggers an email to the victim and makes no further progress.",
      "The reply names the destination in MASKED form (`maskedEmail`, empty when nothing was sent) so a person can tell which inbox to check instead of burning attempts on a typo.",
      "**This is an enumeration trade-off.** Returning the masked address means a caller can tell a real account from a fake one. It is accepted because the flow is rate limited per IP, the per-address code limit still protects any victim's inbox, and the alternative is a dead end. Strict indistinguishability would mean dropping `maskedEmail` from the response.",
      "Accepts a USERNAME as well as an email in `identifier` — people who cannot sign in frequently do not remember which they used.",
      "Rate limited per address AND per IP, and a code is valid for 15 minutes and for 5 wrong guesses.",
      "Use `POST /api/auth/set-password/request` instead when the account is known to have no password — same mechanism, but its wording and rules are specific to claiming one.",
    ],
    params: [
      { name: "identifier", in: "body", type: "string", required: true, description: "The email OR username on the account.", example: "you@company.com" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/auth/forgot-password \\
  -H "Content-Type: application/json" \\
  -d '{"identifier":"you@company.com"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": {
  "sent": true,
  "maskedEmail": "yo*******@c***.com"
} }`,
    },
    errors: [
      { status: 429, code: "RATE_LIMITED", when: "Too many reset requests from this IP, or codes requested for this address." },
      { status: 503, code: "EMAIL_DELIVERY_FAILED", when: "The code could not be sent." },
    ],
  },
  {
    id: "dash-forgot-password-verify",
    method: "POST",
    path: "/api/auth/forgot-password/verify",
    group: "dashboard",
    title: "Check the reset code before setting a password",
    summary: "Validate the code on its own, so the client only shows the password fields to someone who can read the mailbox.",
    auth: "none",
    notes: [
      "Does **not** consume the code — `POST /api/auth/forgot-password/confirm` does that, which is what keeps it single-use.",
      "Everything else is enforced in full: the 15-minute expiry, and the five-attempt budget that destroys the code when it is spent. A wrong guess here costs exactly as much as one at the real step, so this cannot be used to brute-force the code for free.",
      "A username works here too, and anywhere else an email is accepted.",
    ],
    params: [
      { name: "identifier", in: "body", type: "string", required: true, description: "The email OR username on the account.", example: "you@company.com" },
      { name: "code", in: "body", type: "string", required: true, description: "The 6-digit code from the email.", example: "123456" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/auth/forgot-password/verify \\
  -H "Content-Type: application/json" \\
  -d '{"identifier":"you@company.com","code":"123456"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": {
  "valid": true,
  "maskedEmail": "yo*******@c***.com"
} }`,
    },
    errors: [
      { status: 400, code: "INVALID_VERIFICATION_CODE", when: "The code is wrong, or no reset is in progress." },
      { status: 400, code: "VERIFICATION_CODE_EXPIRED", when: "The code is older than 15 minutes." },
      { status: 429, code: "TOO_MANY_CODE_ATTEMPTS", when: "Five wrong guesses; the code is destroyed." },
    ],
  },
  {
    id: "dash-forgot-password-confirm",
    method: "POST",
    path: "/api/auth/forgot-password/confirm",
    group: "dashboard",
    title: "Reset the password with a code",
    summary: "Exchange the emailed code for a new password, then sign in.",
    auth: "none",
    notes: [
      "Writes the new password whether the account had one or not — the same single write covers both, matching what `POST /api/auth/forgot-password` promised.",
      "**Every other session for the account is revoked before the new one is issued.** That is what makes this a reset rather than a rename: someone replacing a password they believe is compromised needs whoever was using it locked out. A reset that left old sessions alive would defeat its own purpose.",
      "A `reset_password` code cannot be replayed as a `set_password` or `verify_email` one even if the digits coincide — the purpose is mixed into the stored hash.",
      "Confirming the code also marks the address verified, because the code proves control of the mailbox.",
      "On success a **'password changed' notice is emailed** to the owner, and this device is signed in — the person has just proved they own the mailbox, so asking them to type the new password again would be pure friction. The notice is what makes a hijacked mailbox visible to the real owner.",
      "`identifier` may be a USERNAME instead of an email, exactly as on the request step.",
    ],
    params: [
      { name: "identifier", in: "body", type: "string", required: true, description: "The email OR username the code was sent for.", example: "you@company.com" },
      { name: "code", in: "body", type: "string", required: true, description: "The 6-digit code from the email.", example: "713844" },
      { name: "password", in: "body", type: "string", required: true, description: "The NEW password to store. 8+ chars with upper case, lower case and a number.", example: "NewOwner456" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/auth/forgot-password/confirm \\
  -H "Content-Type: application/json" -c cookies.txt \\
  -d '{"identifier":"you@company.com","code":"713844","password":"NewOwner456"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": { "user": { "id": "6abc…", "authSource": "self",
                       "emailVerified": true, "hasPassword": true } }
}`,
    },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "Weak password, or a malformed code." },
      { status: 400, code: "INVALID_VERIFICATION_CODE", when: "Wrong code, or none was ever issued." },
      { status: 400, code: "VERIFICATION_CODE_EXPIRED", when: "The code was right but has expired." },
      { status: 429, code: "TOO_MANY_CODE_ATTEMPTS", when: "The 5-attempt budget was spent; the code is destroyed." },
    ],
  },
  {
    id: "dash-set-password",
    method: "POST",
    path: "/api/auth/set-password/confirm",
    group: "dashboard",
    title: "Set a password with a code",
    summary: "Exchange the emailed code for a real password, then sign in.",
    auth: "none",
    notes: [
      "The code is what proves the requester owns the mailbox — that is the entire reason this flow is safe. Without it, anyone who learned an address could claim an account that had no password.",
      "On success the account gains a normal password and the caller is signed in. From here it is indistinguishable from a self-registered account: same row, same login path, no flag flipped.",
      "A `set_password` code cannot be replayed as a `verify_email` one even if the digits coincide — the purpose is mixed into the stored hash.",
    ],
    params: [
      { name: "email", in: "body", type: "string", required: true, description: "The address the code was sent to.", example: "you@company.com" },
      { name: "code", in: "body", type: "string", required: true, description: "The 6-digit code from the email.", example: "713844" },
      { name: "password", in: "body", type: "string", required: true, description: "The password to store. 8+ chars with upper case, lower case and a number.", example: "Owner123" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/auth/set-password/confirm \\
  -H "Content-Type: application/json" -c cookies.txt \\
  -d '{"email":"you@company.com","code":"713844","password":"Owner123"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": { "user": { "id": "6abc…", "authSource": "platform",
                       "emailVerified": true, "hasPassword": true } }
}`,
    },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "Weak password, or a malformed code." },
      { status: 400, code: "INVALID_VERIFICATION_CODE", when: "Wrong code, or none was ever issued." },
      { status: 400, code: "VERIFICATION_CODE_EXPIRED", when: "The code was correct but has timed out." },
      { status: 409, code: "NO_PASSWORD_SET", when: "This account already has a password. Use the change-password flow." },
      { status: 429, code: "TOO_MANY_CODE_ATTEMPTS", when: "Too many wrong codes; the code was destroyed." },
    ],
  },
  {
    id: "dash-login",
    method: "POST",
    path: "/api/auth/login",
    group: "dashboard",
    title: "Sign in",
    summary: "Exchange credentials for the `fa_session` cookie.",
    auth: "none",
    notes: [
      "Send the cookie with curl's `-c`/`-b` or a cookie jar. It is httpOnly, so JavaScript cannot read it.",
      "Failures are deliberately generic so the endpoint cannot be used to discover which accounts exist — with one deliberate exception: an account that exists but has NO password answers `409 NO_PASSWORD_SET` rather than \"incorrect password\". That is a real (accepted) enumeration trade-off, because the alternative is telling someone with a genuine account that they can never sign in. `POST /api/auth/set-password/request` is the fix.",
      "`403 EMAIL_NOT_VERIFIED` means the password was CORRECT but the address is unconfirmed — enter the emailed code and sign in again.",
    ],
    params: [
      { name: "identifier", in: "body", type: "string", required: true, description: "Either the email or the username.", example: "you@company.com" },
      { name: "password", in: "body", type: "string", required: true, description: "Account password.", example: "Owner123" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/auth/login \\
  -H "Content-Type: application/json" -c cookies.txt \\
  -d '{"identifier":"you@company.com","password":"Owner123"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": { "id": "6abc…", "email": "you@company.com", "username": "acme",
            "authSource": "self", "emailVerified": true, "hasPassword": true,
            "createdAt": "…", "lastLoginAt": "…" }
}`,
    },
    errors: [
      { status: 401, code: "INVALID_CREDENTIALS", when: "Wrong identifier or password." },
      { status: 403, code: "EMAIL_NOT_VERIFIED", when: "Password is right; confirm the emailed code." },
      { status: 409, code: "NO_PASSWORD_SET", when: "This account has no password. `details.providers` lists the platforms it is linked to (empty for an operator-created account), so a client can name the right one. Request a code to set a password." },
      { status: 429, code: "RATE_LIMITED", when: "Too many attempts for this IP." },
    ],
  },
  {
    id: "dash-me",
    method: "GET",
    path: "/api/auth/me",
    group: "dashboard",
    title: "Current account",
    summary: "Return the signed-in dashboard account.",
    auth: "cookie",
    requestExample: { lang: "bash", code: `curl {{BASE_URL}}/api/auth/me -b cookies.txt` },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": { "id": "6abc…", "email": "you@company.com", "username": "acme",
            "name": "Ada Lovelace",
            "createdAt": "…", "lastLoginAt": "…" }
}`,
    },
    errors: [{ status: 401, code: "UNAUTHORIZED", when: "Cookie missing, expired or revoked." }],
  },
  {
    id: "dash-change-password",
    method: "POST",
    path: "/api/auth/change-password",
    group: "dashboard",
    title: "Change password",
    summary: "Change the account password and revoke every other session.",
    auth: "cookie",
    notes: ["All other sessions are invalidated and the calling browser is re-issued a session, so a stolen cookie cannot outlive a password change."],
    params: [
      { name: "currentPassword", in: "body", type: "string", required: true, description: "Existing password." },
      { name: "newPassword", in: "body", type: "string", required: true, description: "8+ chars, mixed case and a number." },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/auth/change-password \\
  -H "Content-Type: application/json" -b cookies.txt -c cookies.txt \\
  -d '{"currentPassword":"Owner123","newPassword":"NewOwner456"}'`,
    },
    responseExample: { lang: "json", code: `{ "success": true, "data": { "updated": true } }` },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "The new password fails the policy." },
      { status: 401, code: "INVALID_CREDENTIALS", when: "`currentPassword` is wrong." },
    ],
  },
  {
    id: "dash-logout",
    method: "POST",
    path: "/api/auth/logout",
    group: "dashboard",
    title: "Sign out",
    summary: "Revoke the dashboard session and clear the cookie. Idempotent.",
    auth: "cookie",
    requestExample: { lang: "bash", code: `curl -X POST {{BASE_URL}}/api/auth/logout -b cookies.txt` },
    responseExample: { lang: "json", code: `{ "success": true, "data": { "loggedOut": true } }` },

  // ── Applications ───────────────────────────────────────────────────────
  },
  {
    id: "dash-apps-list",
    method: "GET",
    path: "/api/dashboard/applications",
    group: "dashboard",
    title: "List applications",
    summary: "Every application owned by the signed-in account.",
    auth: "cookie",
    requestExample: { lang: "bash", code: `curl {{BASE_URL}}/api/dashboard/applications -b cookies.txt` },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": {
    "applications": [{
      "id": "6abc…", "ownerId": "6abd…", "name": "MyGame",
      "description": "Our shooter", "appId": "fa_XXXXXXXXXXXXXXXX",
      "appSecretFingerprint": "a91c", "appSecretRotatedAt": "…",
      "createdAt": "…", "updatedAt": "…"
    }]
  }
}`,
    },
  },
  {
    id: "dash-apps-create",
    method: "POST",
    path: "/api/dashboard/applications",
    group: "dashboard",
    title: "Create an application",
    summary: "Create an application and receive its `appId` and `appSecret` once.",
    auth: "cookie",
    successStatus: 201,
    notes: [
      "The `appSecret` is returned EXACTLY ONCE — only a SHA-256 hash is stored and it cannot be recovered.",
      "Subject to the account's plan. With no slots left this returns `403 APP_LIMIT_REACHED`.",
    ],
    params: [
      { name: "name", in: "body", type: "string", required: true, description: "Display name, 1–64 chars.", example: "MyGame" },
      { name: "description", in: "body", type: "string", required: false, description: "Up to 280 chars." },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/dashboard/applications \\
  -H "Content-Type: application/json" -b cookies.txt \\
  -d '{"name":"MyGame","description":"Our shooter"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": { "id": "6abc…", "name": "MyGame", "appId": "fa_XXXXXXXXXXXXXXXX",
            "appSecret": "fas_…", "appSecretFingerprint": "a91c" }
}`,
    },
    errors: [
      { status: 403, code: "APP_LIMIT_REACHED", when: "The plan has no free application slot." },
      { status: 429, code: "RATE_LIMITED", when: "Too many requests." },
    ],
  },
  {
    id: "dash-app-get",
    method: "GET",
    path: "/api/dashboard/applications/{appId}",
    group: "dashboard",
    title: "Get an application",
    summary: "Fetch one application you own.",
    auth: "cookie",
    params: [
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId from the URL (NOT the public `fa_…` id).", example: "6abc…" },
    ],
    requestExample: { lang: "bash", code: `curl {{BASE_URL}}/api/dashboard/applications/6abc… -b cookies.txt` },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "application": { "id": "6abc…", "name": "MyGame", "appId": "fa_XXXXXXXXXXXXXXXX" } } }`,
    },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "`appId` is not a valid ObjectId." },
      { status: 404, code: "NOT_FOUND", when: "No such application, or it belongs to another account." },
    ],
  },
  {
    id: "dash-app-update",
    method: "PATCH",
    path: "/api/dashboard/applications/{appId}",
    group: "dashboard",
    title: "Rename / describe",
    summary: "Update the name and/or description.",
    auth: "cookie",
    notes: ["Only the fields you send change. `ownerId` cannot be set — mass-assignment is rejected."],
    params: [
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "name", in: "body", type: "string", required: false, description: "New display name." },
      { name: "description", in: "body", type: "string", required: false, description: "New description." },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X PATCH {{BASE_URL}}/api/dashboard/applications/6abc… \\
  -H "Content-Type: application/json" -b cookies.txt -d '{"name":"MyGame v2"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "application": { "id": "6abc…", "name": "MyGame v2" } } }`,
    },
    errors: [{ status: 404, code: "NOT_FOUND", when: "Not yours, or does not exist." }],
  },


  {
    id: "dash-app-rotate",
    method: "POST",
    path: "/api/dashboard/applications/{appId}/rotate-secret",
    group: "dashboard",
    title: "Rotate the app secret",
    summary: "Issue a new application secret and return it once.",
    auth: "cookie",
    notes: ["The previous secret stops working IMMEDIATELY; clients still sending it get `INVALID_APP_SECRET`."],
    params: [{ name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." }],
    requestExample: { lang: "bash", code: `curl -X POST {{BASE_URL}}/api/dashboard/applications/6abc…/rotate-secret -b cookies.txt` },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "application": { "appId": "fa_XXXXXXXXXXXXXXXX", "appSecret": "fas_…" } } }`,
    },
    errors: [{ status: 404, code: "NOT_FOUND", when: "Not yours, or does not exist." }],
  },
  {
    id: "dash-app-delete",
    method: "DELETE",
    path: "/api/dashboard/applications/{appId}",
    group: "dashboard",
    title: "Delete an application",
    summary: "Permanently delete the application, its users, devices, sessions and logs.",
    auth: "cookie",
    notes: ["Cascades and cannot be undone. Runs in a transaction where the deployment supports one."],
    params: [{ name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." }],
    requestExample: { lang: "bash", code: `curl -X DELETE {{BASE_URL}}/api/dashboard/applications/6abc… -b cookies.txt` },
    responseExample: { lang: "json", code: `{ "success": true, "data": { "deleted": true } }` },
    errors: [{ status: 404, code: "NOT_FOUND", when: "Not yours, or does not exist." }],
  },
  // ── Application users ──────────────────────────────────────────────────
  {
    id: "dash-users-list",
    method: "GET",
    path: "/api/dashboard/applications/{appId}/users",
    group: "dashboard",
    title: "List application users",
    summary: "Paginated end users belonging to one application.",
    auth: "cookie",
    params: [
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "page", in: "query", type: "number", required: false, description: "1-based page, default 1." },
      { name: "limit", in: "query", type: "number", required: false, description: "1–100, default 25." },
      { name: "search", in: "query", type: "string", required: false, description: "Prefix match on username." },
      { name: "status", in: "query", type: "string", required: false, description: "`active`, `banned` or `expired`." },
    ],
    requestExample: {
      lang: "bash",
      code: `curl "{{BASE_URL}}/api/dashboard/applications/6abc…/users?status=banned" -b cookies.txt`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": {
    "users": [{
      "id": "6abd…", "applicationId": "6abc…", "username": "player123",
      "isBanned": false, "banReason": null, "bannedAt": null,
      "expiresAt": "2026-10-30T00:00:00.000Z", "isExpired": false,
      "maxDevices": 2, "lastLoginAt": "…", "notes": "",
      "createdAt": "…", "updatedAt": "…"
    }],
    "total": 1, "page": 1, "limit": 25, "totalPages": 1
  }
}`,
    },
    errors: [{ status: 404, code: "NOT_FOUND", when: "Not yours, or does not exist." }],
  },
  {
    id: "dash-users-create",
    method: "POST",
    path: "/api/dashboard/applications/{appId}/users",
    group: "dashboard",
    title: "Create an application user",
    summary: "Issue credentials to an end user.",
    auth: "cookie",
    successStatus: 201,
    params: [
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "name", in: "body", type: "string", required: true, description: "Display name, 1–80 chars. Shown in your user list; the client authenticates with `username` below.", example: "Peter Player" },
      { name: "username", in: "body", type: "string", required: true, description: "Up to 254 characters, any characters except control codes, unique within this app. Case-insensitive — an opaque token or an email address is fine.", example: "player123" },
      { name: "password", in: "body", type: "string", required: true, description: "Any characters, 1–72 bytes. No character-class rules: end-user credentials are your product's business.", example: "x" },
      { name: "maxDevices", in: "body", type: "number", required: false, description: "Device seats, 1–100. Default 1." },
      {
        name: "expiresAt",
        in: "body",
        type: "string | null",
        required: false,
        description: 'Absolute ISO-8601 expiry, `"lifetime"`, or `null`. Default lifetime.',
        example: "2026-10-30T00:00:00.000Z",
      },
      { name: "notes", in: "body", type: "string", required: false, description: "Private note, up to 500 chars." },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/dashboard/applications/6abc…/users \\
  -H "Content-Type: application/json" -b cookies.txt \\
  -d '{"name":"Peter Player","username":"player123","password":"Secret123","maxDevices":2,
       "expiresAt":"2026-10-30T00:00:00.000Z"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "id": "6abd…", "username": "player123",
              "maxDevices": 2, "expiresAt": "2026-10-30T00:00:00.000Z", "isExpired": false } }`,
    },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "Weak password or malformed fields." },
      { status: 409, code: "USERNAME_TAKEN", when: "That username exists in this application." },
    ],
  },


  {
    id: "dash-user-get",
    method: "GET",
    path: "/api/dashboard/applications/{appId}/users/{userId}",
    group: "dashboard",
    title: "Get an application user",
    summary: "Fetch one end user you own.",
    auth: "cookie",
    params: [
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "userId", in: "path", type: "string", required: true, description: "User ObjectId." },
    ],
    requestExample: { lang: "bash", code: `curl {{BASE_URL}}/api/dashboard/applications/6abc…/users/6abd… -b cookies.txt` },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "user": { "id": "6abd…", "username": "player123", "maxDevices": 2 } } }`,
    },
    errors: [{ status: 404, code: "NOT_FOUND", when: "Not yours, or the user belongs to another application." }],
  },
  {
    id: "dash-user-update",
    method: "PATCH",
    path: "/api/dashboard/applications/{appId}/users/{userId}",
    group: "dashboard",
    title: "Update an application user",
    summary: "Change the display name, notes, device limit, expiry, or reset the password.",
    auth: "cookie",
    notes: [
      "Sending `password` revokes every live session for that user immediately. Prefer `POST .../reset-password` where you want the server to generate it for you.",
      "The username is NOT editable — it is the credential the client authenticates with, and changing it would strand every deployed client.",
    ],
    params: [
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "userId", in: "path", type: "string", required: true, description: "User ObjectId." },
      { name: "name", in: "body", type: "string", required: false, description: "New display name, 1–80 chars.", example: "Peter Player" },
      { name: "maxDevices", in: "body", type: "number", required: false, description: "New seat count, 1–100." },
      { name: "expiresAt", in: "body", type: "string | null", required: false, description: 'ISO-8601, `"lifetime"` or `null`.' },
      { name: "password", in: "body", type: "string", required: false, description: "New password; revokes all sessions." },
      { name: "notes", in: "body", type: "string", required: false, description: "Private note." },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X PATCH {{BASE_URL}}/api/dashboard/applications/6abc…/users/6abd… \\
  -H "Content-Type: application/json" -b cookies.txt \\
  -d '{"name":"Peter Player","maxDevices":3,"notes":"VIP"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "user": { "id": "6abd…", "maxDevices": 3, "notes": "VIP" } } }`,
    },
    errors: [{ status: 404, code: "NOT_FOUND", when: "Not yours, or does not exist." }],
  },
  {
    id: "dash-user-delete",
    method: "DELETE",
    path: "/api/dashboard/applications/{appId}/users/{userId}",
    group: "dashboard",
    title: "Delete an application user",
    summary: "Remove the user, their devices and sessions. Audit logs are retained.",
    auth: "cookie",
    params: [
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "userId", in: "path", type: "string", required: true, description: "User ObjectId." },
    ],
    requestExample: { lang: "bash", code: `curl -X DELETE {{BASE_URL}}/api/dashboard/applications/6abc…/users/6abd… -b cookies.txt` },
    responseExample: { lang: "json", code: `{ "success": true, "data": { "deleted": true } }` },
    errors: [{ status: 404, code: "NOT_FOUND", when: "Not yours, or does not exist." }],
  },
  {
    id: "dash-user-ban",
    method: "POST",
    path: "/api/dashboard/applications/{appId}/users/{userId}/ban",
    group: "dashboard",
    title: "Ban a user",
    summary: "Block sign-in and optionally revoke every live session.",
    auth: "cookie",
    notes: ["`revokeSessions` defaults to true — a ban that left sessions alive would be trivially bypassed."],
    params: [
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "userId", in: "path", type: "string", required: true, description: "User ObjectId." },
      { name: "reason", in: "body", type: "string", required: false, description: "Up to 280 chars, stored on the user." },
      { name: "revokeSessions", in: "body", type: "boolean", required: false, description: "Default `true`." },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/dashboard/applications/6abc…/users/6abd…/ban \\
  -H "Content-Type: application/json" -b cookies.txt \\
  -d '{"reason":"Chargeback fraud","revokeSessions":true}'`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "user": { "isBanned": true, "banReason": "Chargeback fraud" }, "sessionsRevoked": 2 } }`,
    },
    errors: [{ status: 404, code: "NOT_FOUND", when: "Not yours, or does not exist." }],
  },
  {
    id: "dash-user-unban",
    method: "POST",
    path: "/api/dashboard/applications/{appId}/users/{userId}/unban",
    group: "dashboard",
    title: "Unban a user",
    summary: "Lift a ban. The body is optional.",
    auth: "cookie",
    params: [
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "userId", in: "path", type: "string", required: true, description: "User ObjectId." },
      { name: "revokeSessions", in: "body", type: "boolean", required: false, description: "Also kill sessions issued during the ban. Default `false`." },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/dashboard/applications/6abc…/users/6abd…/unban \\
  -H "Content-Type: application/json" -b cookies.txt -d '{}'`,
    },
    responseExample: { lang: "json", code: `{ "success": true, "data": { "user": { "isBanned": false, "banReason": null } } }` },
    errors: [{ status: 404, code: "NOT_FOUND", when: "Not yours, or does not exist." }],
  },


  {
    id: "dash-user-extend",
    method: "POST",
    path: "/api/dashboard/applications/{appId}/users/{userId}/extend",
    group: "dashboard",
    title: "Extend an expiry",
    summary: "Add days to a licence, from now or from the previous expiry.",
    auth: "cookie",
    notes: [
      '`from: "previous"` continues from the current expiry — this restores an expired licence for its FULL remaining term, not just the days that already elapsed.',
    ],
    params: [
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "userId", in: "path", type: "string", required: true, description: "User ObjectId." },
      { name: "days", in: "body", type: "number", required: true, description: "1–3650 days to add." },
      { name: "from", in: "body", type: "string", required: false, description: '`"now"` (default) or `"previous"`.' },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/dashboard/applications/6abc…/users/6abd…/extend \\
  -H "Content-Type: application/json" -b cookies.txt \\
  -d '{"days":30,"from":"previous"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "user": { "expiresAt": "2026-10-30T00:00:00.000Z", "isExpired": false } } }`,
    },
    errors: [{ status: 404, code: "NOT_FOUND", when: "Not yours, or does not exist." }],
  },
  {
    id: "dash-user-reset-devices",
    method: "POST",
    path: "/api/dashboard/applications/{appId}/users/{userId}/reset-devices",
    group: "dashboard",
    title: "Reset devices",
    summary: "Free every device seat and revoke the sessions bound to them.",
    auth: "cookie",
    params: [
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "userId", in: "path", type: "string", required: true, description: "User ObjectId." },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/dashboard/applications/6abc…/users/6abd…/reset-devices -b cookies.txt`,
    },
    responseExample: { lang: "json", code: `{ "success": true, "data": { "devicesRemoved": 2 } }` },
    errors: [{ status: 404, code: "NOT_FOUND", when: "Not yours, or does not exist." }],
  },
  {
    id: "dash-user-revoke-sessions",
    method: "POST",
    path: "/api/dashboard/applications/{appId}/users/{userId}/revoke-sessions",
    group: "dashboard",
    title: "Revoke all sessions",
    summary: "Sign the user out everywhere without touching their devices.",
    auth: "cookie",
    params: [
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "userId", in: "path", type: "string", required: true, description: "User ObjectId." },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/dashboard/applications/6abc…/users/6abd…/revoke-sessions -b cookies.txt`,
    },
    responseExample: { lang: "json", code: `{ "success": true, "data": { "revoked": 3 } }` },
    errors: [{ status: 404, code: "NOT_FOUND", when: "Not yours, or does not exist." }],
  },


  // ── Read models ─────────────────────────────────────────────────────────
  {
    id: "dash-devices",
    method: "GET",
    path: "/api/dashboard/applications/{appId}/devices",
    group: "dashboard",
    title: "List devices",
    summary: "Devices registered by this application's end users, with the owning user on each row.",
    auth: "cookie",
    notes: [
      "Every row carries `userId` and `username`, so a cross-user list still says *whose* seat each device is consuming.",
      "`search` matches the device id, name, platform and last IP.",
    ],
    params: [
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "userId", in: "query", type: "string", required: false, description: "Filter to one user." },
      { name: "search", in: "query", type: "string", required: false, description: "Substring match on device id, name, platform or IP." },
      { name: "page", in: "query", type: "number", required: false, description: "1-based page." },
      { name: "limit", in: "query", type: "number", required: false, description: "1–100." },
    ],
    requestExample: { lang: "bash", code: `curl {{BASE_URL}}/api/dashboard/applications/6abc…/devices -b cookies.txt` },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": {
    "devices": [{ "id": "6abc…", "deviceId": "device-8f2a91c4", "deviceName": "Alice's PC",
                  "userId": "6abd…", "username": "player123",
                  "firstSeenAt": "…", "lastSeenAt": "…",
                  "lastIp": "203.0.113.9", "platform": "Windows" }],
    "total": 1
  }
}`,
    },
    errors: [{ status: 404, code: "NOT_FOUND", when: "Not yours, or does not exist." }],
  },
  {
    id: "dash-device-delete",
    method: "DELETE",
    path: "/api/dashboard/applications/{appId}/devices/{deviceId}",
    group: "dashboard",
    title: "Remove a device",
    summary: "Free one device seat and stop that device authenticating.",
    auth: "cookie",
    notes: [
      "Sessions bound to the device are revoked as part of the delete, so the device stops authenticating immediately instead of keeping a session until it expires.",
      "The end user is **not** banned and their other devices keep working. If the removed device logs in again it is re-registered and consumes a seat again — this frees a seat, it does not blacklist the machine.",
      "To free every seat a user holds at once, use **Reset devices** on the user.",
    ],
    params: [
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "deviceId", in: "path", type: "string", required: true, description: "Device ObjectId (the `id` from **List devices**), not the client-supplied `deviceId` string." },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X DELETE {{BASE_URL}}/api/dashboard/applications/6abc…/devices/6abf… -b cookies.txt`,
    },
    responseExample: { lang: "json", code: `{ "success": true, "data": { "deleted": true } }` },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "`deviceId` is not a valid ObjectId." },
      { status: 404, code: "NOT_FOUND", when: "Not yours, or the device does not exist." },
    ],
  },
  {
    id: "dash-sessions",
    method: "GET",
    path: "/api/dashboard/applications/{appId}/sessions",
    group: "dashboard",
    title: "List sessions",
    summary: "Every session issued to this application's end users.",
    auth: "cookie",
    params: [
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "userId", in: "query", type: "string", required: false, description: "Filter to one user." },
    ],
    requestExample: { lang: "bash", code: `curl {{BASE_URL}}/api/dashboard/applications/6abc…/sessions -b cookies.txt` },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": {
    "sessions": [{ "id": "6abc…", "deviceId": "device-8f2a91c4", "createdAt": "…",
                   "expiresAt": "…", "revokedAt": null, "lastUsedAt": "…",
                   "ip": "203.0.113.9", "isActive": true }],
    "total": 1
  }
}`,
    },
    errors: [{ status: 404, code: "NOT_FOUND", when: "Not yours, or does not exist." }],
  },
  {
    id: "dash-logs",
    method: "GET",
    path: "/api/dashboard/applications/{appId}/logs",
    group: "dashboard",
    title: "Read the audit log",
    summary: "Authentication events, newest first.",
    auth: "cookie",
    notes: ["Records identifiers and outcomes only — never passwords, tokens or secrets."],
    params: [
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "action", in: "query", type: "string", required: false, description: "Filter to one action, e.g. `LOGIN_FAILED`." },
      { name: "page", in: "query", type: "number", required: false, description: "1-based page." },
      { name: "limit", in: "query", type: "number", required: false, description: "1–100, default 25." },
    ],
    requestExample: {
      lang: "bash",
      code: `curl "{{BASE_URL}}/api/dashboard/applications/6abc…/logs?action=LOGIN_FAILED" -b cookies.txt`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": {
    "logs": [{ "id": "6abc…", "username": "player123", "action": "LOGIN_FAILED",
               "success": false, "reason": "INVALID_CREDENTIALS",
               "ip": "203.0.113.9", "deviceId": "device-8f2a91c4", "createdAt": "…" }],
    "total": 1, "page": 1, "limit": 25
  }
}`,
    },
    errors: [{ status: 404, code: "NOT_FOUND", when: "Not yours, or does not exist." }],
  },
  {
    id: "dash-stats",
    method: "GET",
    path: "/api/dashboard/applications/{appId}/stats",
    group: "dashboard",
    title: "Application statistics",
    summary: "User, device and session counters for one application.",
    auth: "cookie",
    params: [{ name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." }],
    requestExample: { lang: "bash", code: `curl {{BASE_URL}}/api/dashboard/applications/6abc…/stats -b cookies.txt` },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": {
    "totalUsers": 12, "bannedUsers": 1, "expiredUsers": 2, "activeUsers": 9,
    "devices": 7, "activeSessions": 4,
    "loginsLast7Days": 128, "failuresLast7Days": 6
  }
}`,
    },
    errors: [{ status: 404, code: "NOT_FOUND", when: "Not yours, or does not exist." }],
  },
  {
    id: "dash-profile",
    method: "PATCH",
    path: "/api/auth/profile",
    group: "dashboard",
    title: "Update your profile",
    summary: "Change your own display name.",
    auth: "cookie",
    notes: [
      "Only `name` is editable here. Email and username are identity fields with their own uniqueness rules and recovery flows, and are intentionally not changeable from this route.",
      "There is no `userId` in the body: the target is always the signed-in account, so this cannot be pointed at someone else.",
    ],
    params: [
      { name: "name", in: "body", type: "string", required: true, description: "Display name, 1–80 characters. Spaces, punctuation and non-Latin scripts are allowed.", example: "Ada Lovelace" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X PATCH {{BASE_URL}}/api/auth/profile \\
  -H "Content-Type: application/json" -b cookies.txt \\
  -d '{ "name": "Ada Lovelace" }'`,
    },
    responseExample: { lang: "json", code: `{ "success": true, "data": { "user": { "id": "6abc…", "name": "Ada Lovelace" } } }` },
    errors: [{ status: 400, code: "VALIDATION_ERROR", when: "The name is empty or longer than 80 characters." }],
  },
  {
    id: "dash-app-status",
    method: "PATCH",
    path: "/api/dashboard/applications/{appId}/status",
    group: "dashboard",
    title: "Start or stop an application",
    summary: "Switch the whole application between accepting and refusing authentication.",
    auth: "cookie",
    notes: [
      "While `suspended`, every `/api/v1` authentication call is refused with `503 APP_SUSPENDED` — **new logins and already-issued sessions alike**. Gating only login would leave every signed-in player still being served.",
      "503 rather than 401 on purpose: a client that reads 401 as \"bad token\" will discard a perfectly good session and lock its own player out of your product. Retry-later is the correct interpretation.",
      "Nothing is deleted. Users, devices and sessions are kept, so starting again restores service instantly with players still signed in.",
      "The dashboard stays available while stopped — otherwise there would be no way to press Start.",
    ],
    params: [
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "status", in: "body", type: "string", required: true, description: "`active` to start, `suspended` to stop.", example: "suspended" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X PATCH {{BASE_URL}}/api/dashboard/applications/6abc…/status \\
  -H "Content-Type: application/json" -b cookies.txt \\
  -d '{ "status": "suspended" }'`,
    },
    responseExample: { lang: "json", code: `{ "success": true, "data": { "application": { "id": "6abc…", "status": "suspended" } } }` },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "`status` is neither `active` nor `suspended`." },
      { status: 404, code: "NOT_FOUND", when: "Not yours, or does not exist." },
    ],
  },
  {
    id: "dash-update-device",
    method: "PATCH",
    path: "/api/dashboard/applications/{appId}/devices/{deviceId}",
    group: "dashboard",
    title: "Edit a device",
    summary: "Change a registered device's display name and/or its device id.",
    auth: "cookie",
    notes: [
      "`deviceName` is cosmetic. **`deviceId` is not**: the client identifies itself by that value at login, so after a change a client still sending the old id registers as a NEW device and consumes another seat from that user's allowance. Current sessions are unaffected.",
      "Returns `409 DUPLICATE` if the new `deviceId` already belongs to another device of the **same** user — two rows sharing an identifier would collapse into one on the next login.",
      "The owning user is never read from the request body, so a device cannot be moved between users through this route.",
    ],
    params: [
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "deviceId", in: "path", type: "string", required: true, description: "The device ROW's ObjectId — not the client-supplied identifier." },
      { name: "deviceName", in: "body", type: "string", required: false, description: "Friendly label, 1–80 characters.", example: "Work laptop" },
      { name: "deviceId", in: "body", type: "string", required: false, description: "Replacement identifier: 8–128 chars of `A–Z a–z 0–9 . _ : -`.", example: "device-8f2a91c4" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X PATCH {{BASE_URL}}/api/dashboard/applications/6abc…/devices/6def… \\
  -H "Content-Type: application/json" -b cookies.txt \\
  -d '{ "deviceName": "Work laptop", "deviceId": "device-8f2a91c4" }'`,
    },
    responseExample: { lang: "json", code: `{ "success": true, "data": { "device": { "id": "6def…", "deviceId": "device-8f2a91c4", "deviceName": "Work laptop", "userId": "6abc…", "username": "player123" } } }` },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "No fields supplied, or a value breaks the format rules." },
      { status: 404, code: "NOT_FOUND", when: "Not yours, or does not exist." },
      { status: 409, code: "DUPLICATE", when: "That device id is already registered for this user." },
    ],
  },
  {
    id: "dash-reset-password",
    method: "POST",
    path: "/api/dashboard/applications/{appId}/users/{userId}/reset-password",
    group: "dashboard",
    title: "Reset a user's password",
    summary: "Generate a new password server-side and return it once.",
    auth: "cookie",
    notes: [
      "The plaintext is generated on the server and returned **exactly once** — it is hashed immediately and is not recoverable afterwards. Store it in your support system and hand it to the user directly.",
      "All of that user's live sessions are revoked in the same call, so a stolen session does not outlive the reset.",
      "Prefer having the end user change it themselves via `POST /api/v1/auth/password` where possible.",
    ],
    params: [
      { name: "appId", in: "path", type: "string", required: true, description: "Application ObjectId." },
      { name: "userId", in: "path", type: "string", required: true, description: "Application-user ObjectId." },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/dashboard/applications/6abc…/users/6def…/reset-password \\
  -H "Content-Type: application/json" -b cookies.txt -d '{}'`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": {
    "password": "Kx7#mQ2pLv",
    "sessionsRevoked": 2,
    "user": { "id": "6def…", "username": "player123" }
  }
}`,
    },
    errors: [{ status: 404, code: "NOT_FOUND", when: "Not yours, or does not exist." }],
  },
];
