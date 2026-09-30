# FastAuth

A multi-tenant authentication and licence-management platform. Each customer
registers a dashboard account, creates one or more **applications**, and manages
that application's end users through a REST API — with expirations, bans, device
limits, revocable sessions and a full audit trail.

Built with Next.js 16 (App Router), TypeScript, MongoDB/Mongoose, Tailwind CSS v4
and Lucide icons. No `any` types, no deprecated Next.js APIs.

---

## Architecture

There are two completely separate identity spaces:

| Realm | Who they are | How they authenticate |
| --- | --- | --- |
| **Dashboard account** (`User`) | Your customer | Opaque token in an httpOnly cookie, hashed in `dashboard_sessions` |
| **Application user** (`AppUser`) | The end user of *your customer's* app | `Authorization: Bearer <token>`, hashed in `sessions` |

```
User (owner) ──1:N──> Application ──1:N──> AppUser ──1:N──> Device
                                  ├──1:N──> Session
                                  └──1:N──> AuthLog
```

`Application` is the tenancy boundary. Every `AppUser` / `Device` / `Session` /
`AuthLog` row carries an `applicationId`, and every dashboard query is *also*
scoped by the owner's id resolved from the session cookie.

### The authorisation invariant

```
authenticated dashboard user      (lib/session.ts        -> cookie -> Mongo lookup)
  -> application.ownerId === user (lib/authorization.ts -> requireApplicationOwner)
    -> resource.applicationId === application._id       (requireAppUser)
```

An `applicationId` or `userId` arriving in a URL or body is used **only** to look
up the resource. The ownership decision is always made against the server-side
session identity. A missing resource and a not-owned resource are
indistinguishable (both 404), so the API cannot be used to probe for valid ids.
This is covered by explicit IDOR assertions in the verification suite.

### Two layers of protection

- **`proxy.ts`** (Next.js 16's replacement for `middleware.ts`) — an *optimistic*
  check. It only tests whether a session cookie is present, so anonymous users
  never trigger a dashboard render. It deliberately does not touch the database.
- **The data-access layer** — the authoritative check. Every page and every API
  route re-verifies the cookie against MongoDB. A forged or stale cookie cannot
  read a single protected resource even if it passes the proxy.

---

## Cryptography at a glance

| Secret | Storage | Why |
| --- | --- | --- |
| Passwords | bcrypt, cost 12 | Low entropy ⇒ needs brute-force resistance |
| Session tokens | SHA-256, salted with `SESSION_SECRET` | 256-bit CSPRNG output ⇒ unpredictability, not slowness, is the property that matters. Also far faster per request. |
| App secrets | SHA-256, same scheme | Same reasoning. |

---

## Running it

```bash
npm install
cp .env.example .env.local     # then edit
npm run dev                    # http://localhost:3000
```

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `MONGODB_URI` | yes | `mongodb://127.0.0.1:27017/fast-auth` or an Atlas `mongodb+srv://` URI |
| `SESSION_SECRET` | yes | 32+ chars. Refused in production if weak or left as the example value |
| `COOKIE_SECURE` | no | Defaults to `true` in production, `false` locally |
| `NEXT_PUBLIC_APP_NAME` | no | Branding shown in the UI |
| `DASHBOARD_SESSION_TTL_DAYS` | no | Default `7` |
| `APP_SESSION_TTL_DAYS` | no | Default `30` |
| `LOGIN_RATE_LIMIT_MAX` / `..._WINDOW_SECONDS` | no | Per appId+ip+username |
| `DASHBOARD_LOGIN_RATE_LIMIT_MAX` / `..._WINDOW_SECONDS` | no | Per ip |

### MongoDB

Indexes are declared in the Mongoose schemas and created automatically.
A replica set is optional: cascade deletes run inside a transaction when one is
available and fall back to ordered sequential deletes on a standalone `mongod`
(children first, parent last — so a mid-way failure is always safely retryable).

---

## Verifying

```bash
npm run verify
```

Boots an ephemeral in-memory MongoDB, starts the **production** Next server and
runs 154 behavioural assertions over HTTP — covering registration, tenant
isolation, ban/expiry/device enforcement, session revocation, secret rotation,
cascade delete, validation, the real MongoDB indexes, and that every dashboard
page renders.

```bash
npm run build     # type-check + production build
npm run lint      # eslint
```


Bcrypt is used rather than Argon2id because it is pure JavaScript: it installs

---

## API

Every response uses one envelope.

```jsonc
// success
{ "success": true, "data": { } }

// failure
{ "success": false, "error": "ACCOUNT_BANNED", "message": "This account has been banned." }
```

`error` is a stable machine-readable code; `message` is human-facing.

### Dashboard APIs (httpOnly cookie session)

| Method | Path |
| --- | --- |
| `POST` | `/api/auth/register` |
| `POST` | `/api/auth/login` |
| `POST` | `/api/auth/logout` |
| `GET` | `/api/auth/me` |
| `POST` | `/api/auth/change-password` |
| `POST` | `/api/auth/set-password/request` |
| `POST` | `/api/auth/set-password/confirm` |
| `POST` | `/api/auth/forgot-password` |
| `POST` | `/api/auth/forgot-password/confirm` |
| `GET` `POST` | `/api/dashboard/applications` |
| `GET` `PATCH` `DELETE` | `/api/dashboard/applications/:appId` |
| `POST` | `/api/dashboard/applications/:appId/rotate-secret` |
| `GET` `POST` `PATCH` `DELETE` | `/api/portal/*` — the end-user self-service portal |
| `GET` `POST` | `/api/dashboard/applications/:appId/users` |
| `GET` `PATCH` `DELETE` | `/api/dashboard/applications/:appId/users/:userId` |
| `POST` | `.../users/:userId/ban` · `unban` · `extend` · `reset-devices` · `revoke-sessions` |
| `GET` | `.../devices` · `.../sessions` · `.../logs` · `.../stats` |
| `DELETE` | `.../devices/:deviceId` — free one seat and stop that device authenticating |

**Two password-recovery flows, and why they are not the same thing.**

| | `set-password/*` | `forgot-password/*` |
| --- | --- | --- |
| For an account with **no** password | ✅ writes the first one | ✅ writes the first one |
| For an account that **has** one | ⛔ silently ignored | ✅ replaces it |
| Revokes other sessions | no | **yes** |

`set-password` refuses to touch an account that already works — claiming a live
account by "setting" a password on it is not the same act, and the emailed code
is not a substitute for proving you are its owner. `forgot-password` is the
deliberate exception: it exists to *replace* a credential, so it revokes every
other session for the account before issuing the new one. Someone resetting a
password they believe is compromised needs whoever was using it locked out.

Both mint a 6-digit code that proves control of the mailbox, and the purpose is
mixed into the stored hash, so a code from one can never be spent on the other.

### End-user portal (`/apps/<appId>/…`)

Your application's own end users get their own sign-in screen and dashboard:

- **`/apps/<appId>/login`** — sign in
- **`/apps/<appId>/dashboard`** — your account

Once signed in they can see **when their account expires**, change **their own
display name**, **change their password**, **list their devices**, and **remove a
device** that has been idle long enough.

The application is in the URL rather than a form field, so the sign-in screen
asks for a username and password *alone* — a person never has to copy an id out
of an email — and each application gets its own sign-in URL to link from a game
launcher or an email footer. Your dashboard customers keep `/login` and
`/dashboard`; those are a different realm with a different cookie.

| Rule | Why |
| --- | --- |
| **`appSecret` is never requested** | That is your backend's second factor. A person must never be asked for it. |
| The cookie works for **one application only** | A session for app A cannot open `/apps/<appB>/dashboard`, even in the same browser. |
| Visiting the portal uses **no licence seat** | A browser has no HWID; the portal session is not a device. |
| Only the **display name** is editable | Ban, expiry, device limit and notes are yours, not theirs. |
| A device needs **60 idle minutes** before removal | Freeing a seat is a privilege. Without the delay an account could churn seats at will, or delete the device it is using and be signed out mid-request. |

Set `PORTAL_DEVICE_IDLE_MINUTES=0` to remove the idle rule.

The portal session is an httpOnly `fa_app_session` cookie — a separate realm
from the dashboard customer (`fa_session`) and the operator
(`fa_admin_session`), and none of the three will accept another's cookie. It is
stored in the same `sessions` collection as a game-client session, so banning a
user or revoking their sessions reaches the browser and the client together.

### Public customer API

#### `POST /api/v1/auth/login`

The application id is a **header**, not part of the body:

```bash
curl -X POST https://your-api.example/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-App-Id: fa_XXXXXXXXXXXXXXXX" \
  -d '{
    "username": "player123",
    "password": "Secret123",
    "deviceId": "device-unique-id",
    "appSecret": "fas_...",
    "deviceName": "Alice'"'"'s PC"
  }'
```

```jsonc
// body
{
  "username": "player123",
  "password": "Secret123",
  "deviceId": "device-unique-id",   // 8–128 chars
  "appSecret": "fas_...",           // optional second factor
  "deviceName": "Alice's PC"        // optional
}
```

**End-user credentials are your product's business.** `username` and `password`
are deliberately unconstrained in this realm — no character-class rules, no
minimum length. A Steam ID, an email address, a UUID, an opaque token, a
one-character PIN: all valid. The only rules are that neither may be empty and
both must fit **bcrypt's 72-byte limit** (bytes, not characters — 30 emoji would
exceed it, and past 72 bytes two different passwords would authenticate each
other).

This applies *only* to application users. Dashboard accounts keep the strict
policy, because they belong to this platform rather than to your app.

```jsonc
// 200
{
  "success": true,
  "data": {
    "sessionToken": "…",
    "expiresAt": "2026-10-30T12:00:00.000Z",
    "user": { "username": "player123", "deviceId": "device-unique-id",
              "devicesUsed": 1, "maxDevices": 2, "isNewDevice": true }
  }
}
```

The login pipeline is ordered deliberately — cheap checks first, bcrypt late — so
a flood of requests against banned or expired accounts cannot cost a password
hash:

1. rate limit → 2. resolve application → 3. verify optional app secret →
4. load user **within this application** → 5. verify password → 6. ban check →
7. expiry check → 8. register/refresh device (enforces `maxDevices`) →
9. issue session → 10. write audit log

| Failure | Status | `error` |
| --- | --- | --- |
| Invalid appId | 404 | `INVALID_APPLICATION` |
| Bad app secret | 401 | `INVALID_APP_SECRET` |
| Bad username/password | 401 | `INVALID_CREDENTIALS` |
| Banned | 403 | `ACCOUNT_BANNED` |
| Expired | 403 | `ACCOUNT_EXPIRED` |

---

## Expiration semantics

`expiresAt` is a real `Date`; `null` means the account never expires. A stored
`days: 30` counter cannot express "expired three days ago", which is exactly what
the extend logic must reason about.

Extending offers two anchors:

- `from: "now"` — starts a fresh period.
- `from: "previous"` — continues from the current expiry, so a licence sold as
  "30 days from purchase" is restored for its **full** 30 days rather than the
  days that already elapsed.

## Device limits — what this does and does not guarantee

`deviceId` is a client-supplied identifier. A modified client can claim any value,
so it **cannot** prove "the same physical machine". This is a **seat-control**
mechanism, not tamper-proof DRM. Concretely, it guarantees:

- a licence is capped at N concurrently registered devices;
- each device is enumerable and individually revocable;
- every registration/removal is written to the audit log;
- sessions are bound to the device that created them.

Genuine hardware binding needs platform attestation (TPM / Play Integrity /
Keychain), which is a separate mechanism.

A unique index on `{applicationId, userId, deviceId}` is the real guard against
two concurrent logins both reading "1 of 2 seats used" and both inserting a
third; the count check is only the fast path.

## Privacy

`AuthLog` records identifiers (username, IP, device id) and outcomes — never
passwords, tokens or secret material. The username is denormalised onto the log so
history survives deletion of the user, and logs are deliberately **retained** when
a user is deleted.
---

## Operator console (admin panel)

A back-office for the **project owner**, at `/admin`. It is deliberately a
*third* identity space, separate from both customer realms.

| Realm | Model | Cookie | Sees |
| --- | --- | --- | --- |
| Customer | `User` | `fa_session` | only their own tenant |
| **Operator** | **`AdminUser`** | **`fa_admin_session`** | **every tenant** |
| End user | `AppUser` | `Authorization: Bearer` | its own licence |

### Creating the first admin

```bash
npm run create-admin
npm run create-admin -- --email=me@example.com --username=owner
npm run create-admin -- --email=me@example.com --password='Str0ngPass!'
```

A strong password is generated by default and printed once. Then sign in at
`/admin/login`.

**This CLI is the only way an administrator can be created.** There is
intentionally no HTTP endpoint for it — if admin creation were reachable over
the network, any registration flaw anywhere in the app would become a
full-platform compromise.

### What the panel shows

| Page | Contents |
| --- | --- |
| `/admin` | Platform totals, 14-day login traffic chart, live event feed, top attacking IPs, most-targeted usernames |
| `/admin/customers` | Every dashboard account with app counts |
| `/admin/applications` | Every application with its owning customer |
| `/admin/app-users` | Every end-user licence, filterable by active / banned / expired |
| `/admin/devices` | Every registered device |
| `/admin/sessions` | Every issued session |
| `/admin/logs` | The full platform-wide audit trail |

### Why the isolation is strict

`lib/admin-data.ts` is the **one deliberate exception** to the
"always scope by ownerId" rule that governs the customer services. It does not
scope, because the operator legitimately needs cross-tenant visibility. The
file carries a warning header, and the dependency is strictly one-way: no
customer-facing module may import it.

Even an operator cannot see secrets. `appSecretHash` and `passwordHash` are
never selected, and the E2E suite asserts neither a `fas_` secret nor a `$2b$`
hash ever appears in admin HTML.

Additional hardening:

- Admin sessions are `SameSite=Strict` and scoped to `path=/admin`.
- Admin login is rate limited harder than customer login (5 / 15 min).
- Generic error + timing equalisation, so it cannot enumerate operator emails.
- `robots: noindex` on the whole console.

---

## Social sign-in (Google, GitHub, Microsoft)

The **main administrator** enables and configures providers at
**`/admin/settings/auth-methods`**, alongside the Email+Password method — one
page covers every way to sign in. Customers then get working social sign-in
with no setup of their own. Each provider can be switched on or off
independently for customers and for the admin panel.

| Provider | Notes |
| --- | --- |
| Google | OIDC `userinfo`; Google asserts `email_verified` |
| GitHub | `/user` plus `/user/emails` (needed for a verified-address claim) |
| Microsoft | OIDC, tenant-configurable: `common`, `organizations`, `consumers`, or a tenant GUID |

Register these redirect URIs at your provider:

```
https://your-domain/api/auth/oauth/<provider>/callback   # customers
https://your-domain/api/admin/oauth/<provider>/callback  # operators
```

#### Security model

| Concern | How it is handled |
| --- | --- |
| Client secret at rest | **AES-256-GCM encrypted**, key derived from `SESSION_SECRET` via scrypt. It must be *reversible* (needed to exchange codes), so hashing is impossible. Never returned by any endpoint — the UI only shows whether one is set. |
| Code interception | **PKCE (S256)** on every request. The verifier never leaves the server. |
| CSRF / login fixation | Single-use `state`, sealed into a short-lived httpOnly cookie, compared in **constant time** on return. |
| Account takeover | An account is auto-linked by email only when the provider **asserts it is verified**. An unverified email can never claim an existing account. |
| Identity confusion | Provider **endpoints are hardcoded**, never configurable — otherwise the admin panel would become a credential-forwarding SSRF primitive. |
| Admin escalation | **Admins are never auto-provisioned.** A provider sign-in only succeeds if it matches an admin that already exists (`npm run create-admin`). |
| Ciphertext tampering | The AES-GCM auth tag is verified on decrypt, so tampering is detected rather than silently sent to the provider. |

> **Why "admins never auto-provision" matters:** if any unknown Google account
> could become an administrator, flipping the *Admin sign-in* toggle would hand
> platform-wide access to the entire internet. An operator must therefore be
> created first, with an email matching the provider identity.

#### Test-only endpoint override

`lib/oauth-providers.ts` accepts `OAUTH_TEST_*` overrides so the verification
suite can drive the real PKCE flow against a fake provider. It requires
`OAUTH_ALLOW_TEST_ENDPOINTS=1` **and** a loopback-only host, so even if the flag
somehow leaked it could never forward credentials to a remote attacker. Never
set it in a real deployment.

---

## Subscription plans

A plan is a cap on how many applications an account may own. The catalogue
lives in `lib/plan-catalog.ts` (pure, isomorphic) and enforcement in
`lib/plans.ts` (server-only).

| Plan | Applications | Price (display only) |
| --- | --- | --- |
| **Free** | 2 | `$0` |
| **Starter** | 10 | `$19/mo` |
| **Pro** | 20 | `$49/mo` |
| **Unlimited** | ∞ | Custom |

Every new account — including OAuth-created ones — starts on **Free**.

### Enforcement

The limit is enforced **server-side** in `createApplication`, before any
credentials are generated. Disabling the button in the UI is only a
courtesy; calling the API directly is refused with:

```json
{
  "success": false,
  "error": "APP_LIMIT_REACHED",
  "message": "Your Free plan allows 2 applications and you already have 2. Upgrade your plan or delete an application."
}
```

HTTP `403`. Being *exactly at* the cap still blocks creation — the account must
get back **under** the limit.

### Changing a plan

The main administrator assigns tiers from **Admin → Customers** (the plan
column), or via `PATCH /api/admin/customers/:userId/plan`. There is no
customer-facing endpoint for this: a customer can never raise their own limit.

```bash
curl -X PATCH http://localhost:3000/api/admin/customers/<userId>/plan \
  -H "Cookie: fa_admin_session=…" -H "Content-Type: application/json" \
  -d '{"plan":"pro"}'
```

### Downgrades are non-destructive

Lowering a plan **never deletes** anything. The account simply enters an
`overLimit` state: existing applications keep working, but no new one can be
created until the owner deletes something. Both the customer dashboard and the
admin table show this explicitly.

No billing gateway is integrated — the operator moves accounts between tiers
directly, which is where a Stripe webhook would hook in.

---

## API documentation

Developer docs live at **`/docs`** (public, linked from the landing page), with a
machine-readable **OpenAPI 3.1** spec at **`/docs/openapi.json`**.

| | |
| --- | --- |
| Quickstart | Four calls from application to session check |
| Public API | The 4 endpoints you call from your game — full detail |
| Dashboard API | Customer management endpoints |
| Operator API | Platform administration (documented, not for customer use) |
| Error codes | Every machine-readable code with its status |
| Rate limits | Scopes and defaults |
| Plans | Subscription tiers and app caps |

### The domain is never hardcoded

This platform is self-hosted, so there is no single correct domain to write
into an example. The catalogue therefore stores a literal `{{BASE_URL}}`
placeholder, and it is resolved at render time:

| Surface | Resolved from |
| --- | --- |
| The `/docs` page | `window.location.origin` in the browser |
| `/docs/openapi.json` | the incoming request's origin, server-side |
| The OAuth admin panel | `window.location.origin` (the operator's real redirect URIs) |

So the snippets are correct on `localhost`, a preview domain, or production
without editing anything. The placeholder stays literal in the statically
generated HTML — the real origin is only knowable in the browser — which means
that even with JavaScript disabled you see an obvious placeholder rather than a
misleading domain.

The OpenAPI document also carries an `x-curl-example` per operation, with the
base URL already resolved, so importing the spec into Postman gives runnable
requests.

`lib/api-docs/base-url.ts` holds the placeholder and the substitution helper;
`components/docs/use-base-url.ts` is the client hook.

### The docs cannot drift from the code

`lib/api-docs/` is a **typed catalogue** that is the single source of truth for
both the rendered page and the OpenAPI spec. Adding an endpoint means adding one
object; both surfaces update together.

The verification suite then closes the loop by hitting the **running server**:
it probes every path in the spec using the method the spec declares and asserts
each one returns the JSON envelope — so a documented route that does not exist
(or an existing route that is undocumented) fails the build.

```bash
npm run verify   # phase 15 does the drift check
```

The page is server-rendered and statically generated, so it costs nothing at
runtime and stays in step with whatever you deploy.

---

## Project layout

```
app/
├── (auth)/login · register        split-screen auth screens
├── dashboard/
│   ├── page.tsx                   portfolio overview
│   ├── applications/…             list, detail, users, devices, sessions, logs
│   └── settings/
├── admin/
│   ├── login/                     operator sign-in
│   └── (panel)/                   overview, customers, applications, app-users,
│                                   devices, sessions, logs,
│                                   settings/auth-methods (+ social providers)
└── api/
    ├── auth/                      dashboard session (cookie)
    ├── dashboard/applications/…   owner-scoped management
    ├── admin/                     operator console + oauth provider config
    ├── auth/oauth/…               customer social sign-in (PKCE)
    └── v1/auth/                   public customer API (bearer)

models/    User · Application · AppUser · Device · Session · AuthLog
           DashboardSession · AdminUser · AdminSession
           OAuthProvider · OAuthAccount
lib/       mongodb · password · tokens · session · authorization · application
           app-user · device · app-session · v1-auth · auth · logger · stats
           validation · api-response · rate-limit · request · env
           plans · plan-catalog · plan-admin            (subscriptions)
           admin-auth · admin-session · admin-data      (operator only)
           oauth-providers · oauth-crypto · oauth-config
           oauth-flow · oauth-user                      (social sign-in)
components/ui/       modal · toast · alert · copyable-field · badges · empty states
components/auth/     login, register, social sign-in buttons
components/admin/    shell · login form · traffic chart · table page · provider manager
components/docs/     code blocks, endpoint cards (render the API reference)
lib/api-docs/        the endpoint catalogue, base-URL helper + OpenAPI generator
app/docs/            /docs page and /docs/openapi.json
scripts/             verify.mjs + phases/ (end-to-end suite), create-admin.mjs,
                     mock-oauth-provider.mjs
proxy.ts             optimistic auth gate for all three cookie namespaces
```

Route handlers stay thin: they validate, call a service, and return the envelope.
All business logic and every authorisation decision live in `lib/`.
