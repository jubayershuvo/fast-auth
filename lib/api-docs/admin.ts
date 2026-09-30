import type { EndpointDoc } from "./types";

/**
 * The OPERATOR API — platform-owner only, authenticated with the httpOnly
 * `fa_admin_session` cookie.
 *
 * Documented for completeness and for building internal tooling. They are
 * deliberately absent from the customer surface, and a customer session can
 * never reach them.
 *
 * Administrators are provisioned ONLY via `npm run create-admin`; there is no
 * HTTP endpoint that can create one.
 */
export const ADMIN_ENDPOINTS: EndpointDoc[] = [
  {
    id: "admin-login",
    method: "POST",
    path: "/api/admin/auth/login",
    group: "admin",
    title: "Operator sign-in",
    summary: "Exchange operator credentials for the `fa_admin_session` cookie.",
    auth: "none",
    notes: [
      "Rate limited harder than customer login (5 attempts / 15 min by default), because an operator session can read every tenant's data.",
      "Errors are generic, so the endpoint cannot enumerate operator accounts.",
    ],
    params: [
      { name: "identifier", in: "body", type: "string", required: true, description: "Operator email or username." },
      { name: "password", in: "body", type: "string", required: true, description: "Operator password." },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X POST {{BASE_URL}}/api/admin/auth/login \\
  -H "Content-Type: application/json" -c admin-cookies.txt \\
  -d '{"identifier":"root","password":"RootAdmin1"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "id": "6abc…", "email": "root@you.com", "username": "root" } }`,
    },
    errors: [
      { status: 401, code: "INVALID_CREDENTIALS", when: "Wrong identifier or password." },
      { status: 429, code: "RATE_LIMITED", when: "Too many attempts." },
    ],
  },
  {
    id: "admin-me",
    method: "GET",
    path: "/api/admin/auth/me",
    group: "admin",
    title: "Current operator",
    summary: "Return the signed-in operator, or 401.",
    auth: "admin-cookie",
    requestExample: { lang: "bash", code: `curl {{BASE_URL}}/api/admin/auth/me -b admin-cookies.txt` },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "id": "6abc…", "email": "root@you.com", "username": "root" } }`,
    },
    errors: [{ status: 401, code: "UNAUTHORIZED", when: "No operator session." }],
  },
  {
    id: "admin-logout",
    method: "POST",
    path: "/api/admin/auth/logout",
    group: "admin",
    title: "Operator sign-out",
    summary: "Revoke the operator session. Idempotent.",
    auth: "admin-cookie",
    requestExample: { lang: "bash", code: `curl -X POST {{BASE_URL}}/api/admin/auth/logout -b admin-cookies.txt` },
    responseExample: { lang: "json", code: `{ "success": true, "data": { "loggedOut": true } }` },
  },
  {
    id: "admin-plan",
    method: "PATCH",
    path: "/api/admin/customers/{userId}/plan",
    group: "admin",
    title: "Assign a subscription plan",
    summary: "Move a customer between Free / Starter / Pro / Unlimited.",
    auth: "admin-cookie",
    notes: [
      "A downgrade NEVER deletes anything. The account simply enters an over-limit state: existing applications keep working, but no new one can be created until the owner deletes something.",
      "There is no customer-facing equivalent — a customer can never raise their own limit.",
    ],
    params: [
      { name: "userId", in: "path", type: "string", required: true, description: "Customer ObjectId." },
      { name: "plan", in: "body", type: "string", required: true, description: "`free`, `starter`, `pro` or `unlimited`.", example: "pro" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X PATCH {{BASE_URL}}/api/admin/customers/6abc…/plan \\
  -H "Content-Type: application/json" -b admin-cookies.txt -d '{"plan":"pro"}'`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": {
    "result": { "userId": "6abc…", "plan": "pro", "planLabel": "Pro",
                "changed": true, "overLimit": false, "used": 3, "limit": 20 },
    "plans": [ "…" ]
  }
}`,
    },
    errors: [
      { status: 400, code: "INVALID_PLAN", when: "`plan` is not one of the four tiers." },
      { status: 404, code: "NOT_FOUND", when: "No such customer." },
    ],

  },
  {
    id: "admin-auth-methods",
    method: "GET",
    path: "/api/admin/auth-methods",
    group: "admin",
    title: "Sign-in method configuration",
    summary: "Email+password: on/off, registration policy, and the SMTP transport it depends on.",
    auth: "admin-cookie",
    notes: [
      "The SMTP password is **write-only**: it is never returned here or anywhere else, only `hasSmtpPassword`. Send a blank `smtpPassword` to keep the stored one.",
      "`mailConfigured` is `true` when a host is stored here **or** `SMTP_HOST` is set in the environment — an env-only deployment has nothing to paste into the panel, so it still counts.",
      "Disabling the method refuses registration, password sign-in, email verification and password claiming. Existing accounts and existing sessions are untouched: switching off a sign-in method must not lock anyone out of work they have already done.",
      "`allowRegistration` is a separate switch, because \"stop taking new signups but do not lock out existing customers\" is a real state that one boolean cannot express.",
    ],
    requestExample: {
      lang: "bash",
      code: `curl {{BASE_URL}}/api/admin/auth-methods -b admin-cookies.txt`,
    },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": { "methods": [{
    "method": "email_password",
    "enabled": true, "allowRegistration": true,
    "smtpHost": "smtp.example.com", "smtpPort": 587,
    "smtpSecure": "starttls", "smtpUser": "apikey",
    "hasSmtpPassword": true,
    "mailFrom": "no-reply@example.com",
    "mailConfigured": true, "updatedAt": "…"
  }] }
}`,
    },
    errors: [{ status: 401, code: "UNAUTHORIZED", when: "No operator session." }],
  },
  {
    id: "admin-auth-methods-update",
    method: "PATCH",
    path: "/api/admin/auth-methods",
    group: "admin",
    title: "Configure a sign-in method",
    summary: "Enable/disable email+password, or set the SMTP host, port, encryption and credentials.",
    auth: "admin-cookie",
    notes: [
      "**Enabling requires a transport.** `enabled: true` is refused with `400 VALIDATION_ERROR` unless an SMTP host is stored here or `SMTP_HOST` is set in the environment. This method's defining feature is that it PROVES an address, so enabling it without working mail would leave every new account unable to verify — and a platform-created account unable to claim a password.",
      "`smtpHost` must be a **bare host name**. A value with a scheme, port, path or embedded credentials is rejected: nodemailer would consume it verbatim, and `smtp://user:pass@evil.host` would turn this panel into a credential-forwarding primitive.",
      "Credentials take effect on the next send — the transport is rebuilt when the host changes, so no restart is needed.",
      "Blank `smtpPassword` keeps the stored password, so the toggle can be flipped without re-pasting it.",
    ],
    params: [
      { name: "method", in: "body", type: "string", required: false, description: "Which method. Currently only `email_password`.", example: "email_password" },
      { name: "enabled", in: "body", type: "boolean", required: false, description: "Accept password sign-in at all. Requires a transport to turn ON." },
      { name: "allowRegistration", in: "body", type: "boolean", required: false, description: "Accept NEW signups. Turn off to keep sign-in working while refusing new accounts." },
      { name: "smtpHost", in: "body", type: "string", required: false, description: "Bare host name — no scheme, port or path.", example: "smtp.example.com" },
      { name: "smtpPort", in: "body", type: "number", required: false, description: "1–65535. Default 587.", example: "587" },
      { name: "smtpSecure", in: "body", type: "string", required: false, description: "`starttls` (587), `ssl` (465) or `none` (local relay)." },
      { name: "smtpUser", in: "body", type: "string", required: false, description: "Relay username. Leave null for an open relay.", example: "apikey" },
      { name: "smtpPassword", in: "body", type: "string", required: false, description: "Write-only. Blank keeps the stored password." },
      { name: "mailFrom", in: "body", type: "string", required: false, description: "The From address codes are sent from.", example: "no-reply@example.com" },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X PATCH {{BASE_URL}}/api/admin/auth-methods \\
  -H "Content-Type: application/json" -b admin-cookies.txt \\
  -d '{"method":"email_password",
       "smtpHost":"smtp.example.com","smtpPort":587,
       "smtpSecure":"starttls","smtpUser":"apikey",
       "smtpPassword":"relay-secret",
       "mailFrom":"no-reply@example.com",
       "enabled":true}'`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "method": {
    "method": "email_password", "enabled": true,
    "smtpHost": "smtp.example.com", "hasSmtpPassword": true,
    "mailConfigured": true, "…": "…"
} } }`,
    },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "Enabling with no transport, or a host that is not a bare host name." },
      { status: 401, code: "UNAUTHORIZED", when: "No operator session." },
    ],
  },
  {
    id: "admin-oauth-list",
    method: "GET",
    path: "/api/admin/oauth/providers",
    group: "admin",
    title: "List social sign-in providers",
    summary: "Configuration for Google, GitHub and Microsoft. Secrets are never returned.",
    auth: "admin-cookie",
    requestExample: { lang: "bash", code: `curl {{BASE_URL}}/api/admin/oauth/providers -b admin-cookies.txt` },
    responseExample: {
      lang: "json",
      code: `{
  "success": true,
  "data": {
    "providers": [{
      "provider": "google", "label": "Google", "enabled": true,
      "clientId": "…apps.googleusercontent.com", "hasSecret": true,
      "allowCustomerLogin": true, "allowAdminLogin": false,
      "settings": {}, "updatedAt": "…"
    }]
  }
}`,
    },
    errors: [{ status: 401, code: "UNAUTHORIZED", when: "No operator session." }],
  },
  {
    id: "admin-oauth-update",
    method: "PATCH",
    path: "/api/admin/oauth/providers",
    group: "admin",
    title: "Configure a social sign-in provider",
    summary: "Enable/disable a provider, set credentials, choose which realms may use it.",
    auth: "admin-cookie",
    notes: [
      "`clientSecret` is write-only: encrypted with AES-256-GCM at rest and never returned. Omit it to keep the stored value.",
      "Enabling `allowAdminLogin` is refused unless a secret is already stored.",
      "Admin OAuth NEVER auto-provisions an operator — a provider sign-in must match an existing admin account.",
    ],
    params: [
      { name: "provider", in: "body", type: "string", required: true, description: "`google`, `github` or `azure`." },
      { name: "enabled", in: "body", type: "boolean", required: false, description: "Master switch." },
      { name: "clientId", in: "body", type: "string", required: false, description: "OAuth client id." },
      { name: "clientSecret", in: "body", type: "string", required: false, description: "OAuth client secret. Write-only." },
      { name: "allowCustomerLogin", in: "body", type: "boolean", required: false, description: "Show the button on customer sign-in." },
      { name: "allowAdminLogin", in: "body", type: "boolean", required: false, description: "Show the button on operator sign-in." },
      { name: "settings", in: "body", type: "object", required: false, description: 'Azure only: `{ "tenant": "common" }`.' },
    ],
    requestExample: {
      lang: "bash",
      code: `curl -X PATCH {{BASE_URL}}/api/admin/oauth/providers \\
  -H "Content-Type: application/json" -b admin-cookies.txt \\
  -d '{"provider":"google","clientId":"…","clientSecret":"…",
       "enabled":true,"allowCustomerLogin":true}'`,
    },
    responseExample: {
      lang: "json",
      code: `{ "success": true, "data": { "provider": { "provider": "google", "enabled": true, "hasSecret": true } } }`,
    },
    errors: [
      { status: 400, code: "VALIDATION_ERROR", when: "Unknown provider, or enabling admin sign-in with no stored secret." },
      { status: 401, code: "UNAUTHORIZED", when: "No operator session." },
    ],
  },
];
