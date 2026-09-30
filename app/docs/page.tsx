import Link from "next/link";
import { ArrowLeft, BookOpen, Download, Terminal } from "lucide-react";

import { CodeBlock, Code } from "@/components/docs/code-block";
import { EndpointCard } from "@/components/docs/endpoint";
import { ThemeToggle } from "@/components/ui/theme";
import { ERROR_CODES, GROUPS, endpointsByGroup } from "@/lib/api-docs";
import { listPlans } from "@/lib/plan-catalog";

export const metadata = {
  title: "API documentation",
  description: "Integrate FastAuth into your game, desktop app or backend.",
};

/** Section heading with a stable anchor for the table of contents. */
function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line pt-8">
      <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
      {children ? <div className="mt-3 text-[14px] text-ink-muted">{children}</div> : null}
    </section>
  );
}

/**
 * Documentation sections, in page order.
 *
 * Shared by the desktop table of contents and the mobile chip row so the two
 * cannot drift apart — they used to be duplicated verbatim.
 */
const DOC_SECTIONS: ReadonlyArray<readonly [string, string]> = [
  ["introduction", "Introduction"],
  ["quickstart", "Quickstart"],
  ["authentication", "Authentication"],
  ["concepts", "Core concepts"],
  ["public-api", "Public API"],
  ["api-keys", "API keys"],
  ["dashboard-api", "Dashboard API"],
  ["end-user-portal-api", "End-user portal"],
  ["operator-api", "Operator API"],
  ["errors", "Error codes"],
  ["rate-limits", "Rate limits"],
  ["plans", "Plans & limits"],
];

export default function DocsPage() {
  const v1 = endpointsByGroup("v1");
  const keys = endpointsByGroup("keys");
  const dashboard = endpointsByGroup("dashboard");
  const portal = endpointsByGroup("portal");
  const admin = endpointsByGroup("admin");
  const plans = listPlans();

  // Group copy is looked up BY ID rather than by index. `GROUPS[n]` silently
  // re-labels every section after it the moment a group is inserted — which is
  // exactly what happened when the portal group was added between the dashboard
  // and the operator sections.
  const group = (id: (typeof GROUPS)[number]["id"]) => {
    const found = GROUPS.find((g) => g.id === id);
    if (!found) throw new Error(`Unknown docs group: ${id}`);
    return found;
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="flex shrink-0 items-center gap-1.5 text-[13px] text-ink-muted transition-colors hover:text-ink"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Home
            </Link>
            <span className="text-ink-subtle">/</span>
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink">
              <BookOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">API docs</span>
            </span>
          </div>
          {/* Wrapped in a flex row so the two controls shrink together on a
              narrow phone instead of the title pushing them off-screen. */}
          <div className="flex shrink-0 items-center gap-2">
            <a
              href="/docs/openapi.json"
              className="btn btn-sm btn-secondary"
              download
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">OpenAPI</span>
              <span className="sm:hidden">JSON</span>
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 sm:px-7">
        {/*
          Mobile section jump. The sidebar is `hidden lg:block`, so below `lg`
          the page had no navigation at all — on a phone that meant scrolling
          past everything to reach a section.

          This MUST be a sibling of the row below, not a child of it. As a flex
          item of a `flex` row it was stretched to the full page height and
          took a slice of the width, rendering the chips as full-height columns
          and squeezing the prose beside them.
        */}
        <nav
          aria-label="Documentation sections"
          className="sticky top-16 z-10 -mx-5 flex items-center gap-2 overflow-x-auto border-b border-line bg-canvas/95 px-5 py-2.5 sm:-mx-7 sm:px-7 lg:hidden"
        >
          {DOC_SECTIONS.map(([anchor, label]) => (
            <a
              key={anchor}
              href={`#${anchor}`}
              className="shrink-0 whitespace-nowrap rounded-full border border-line bg-surface-900 px-3 py-1.5 text-[13px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="flex gap-8 py-8">
          {/* Table of contents */}
          <nav className="hidden w-52 shrink-0 lg:block">
            <div className="sticky top-20 space-y-1 text-[13px]">
              {DOC_SECTIONS.map(([anchor, label]) => (
                <a
                  key={anchor}
                  href={`#${anchor}`}
                  className="block rounded px-2 py-1 text-ink-muted transition-colors hover:bg-surface-850 hover:text-ink"
                >
                  {label}
                </a>
              ))}
            </div>
          </nav>

          <main className="min-w-0 flex-1 space-y-8">
          {/* ── Introduction ─────────────────────────────────────────── */}
          <Section id="introduction" title="Introduction">
            <p>
              FastAuth gives your application a licence system: you create an
              application, issue credentials to your end users, and call one small
              API from your game, desktop app or launcher to check whether a user
              may run it.
            </p>
            <p className="mt-3">
              The whole public surface is eight endpoints under{" "}
              <Code>/api/v1</Code>: log in, validate, refresh, log out, read your
              own identity, change your own password, and manage your own
              sessions. Everything else manages your account and your
              customers&apos; users.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-line bg-surface-900 p-3.5">
                <p className="text-[13px] font-medium text-ink">For game developers</p>
                <p className="mt-1 text-[13px] text-ink-muted">
                  Start with the{" "}
                  <a href="#public-api" className="text-brand-400 hover:text-brand-300">
                    Public API
                  </a>{" "}
                  — that is all you need in your client.
                </p>
              </div>
              <div className="rounded-lg border border-line bg-surface-900 p-3.5">
                <p className="text-[13px] font-medium text-ink">For backend teams</p>
                <p className="mt-1 text-[13px] text-ink-muted">
                  Use the{" "}
                  <a href="#api-keys" className="text-brand-400 hover:text-brand-300">
                    API keys
                  </a>{" "}
                  to provision users programmatically from your own server.
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-surface-850 px-3.5 py-2.5">
              <Terminal className="h-4 w-4 shrink-0 text-ink-subtle" />
              <p className="text-[13px] text-ink-muted">
                Machine-readable spec:{" "}
                <a href="/docs/openapi.json" className="font-mono text-brand-400 hover:text-brand-300">
                  /docs/openapi.json
                </a>{" "}
                — generated from this same catalogue, so it never drifts.
              </p>
            </div>
          </Section>

          {/* ── Quickstart ───────────────────────────────────────────── */}
          <Section id="quickstart" title="Quickstart">
            <p>
              Four calls, from creating an application to checking a session on
              every launch. The domain below is detected automatically from the
              address bar, so these snippets work on your own deployment.
            </p>
            <p className="mt-2 text-[13px] text-ink-subtle">
              Once a token exists, <Code>POST /api/v1/auth/refresh</Code> extends
              it, so an active player never has to sign in again just because the
              session window closed.
            </p>

            <ol className="mt-4 space-y-4">
              <li>
                <p className="text-[13px] font-medium text-ink">
                  1. Create an application in the dashboard
                </p>
                <p className="mt-1 text-[13px] text-ink-muted">
                  You will receive an <Code>appId</Code> and a one-time{" "}
                  <Code>appSecret</Code>. The secret is shown exactly once — store it
                  now. It is kept server-side as a hash and cannot be recovered.
                </p>
              </li>
              <li>
                <p className="text-[13px] font-medium text-ink">
                  2. Issue credentials to an end user
                </p>
                <div className="mt-2">
                  <CodeBlock
                    lang="bash"
                    code={`curl -X POST {{BASE_URL}}/api/dashboard/applications/APP_ID/users \\
  -H "Content-Type: application/json" -b cookies.txt \\
  -d '{"username":"player123","password":"Secret123","maxDevices":2}'`}
                  />
                </div>
              </li>
              <li>
                <p className="text-[13px] font-medium text-ink">
                  3. Log in from your game to obtain a session token
                </p>
                <div className="mt-2">
                  <CodeBlock
                    lang="bash"
                    code={`curl -X POST {{BASE_URL}}/api/v1/auth/login \\
  -H "Content-Type: application/json" \\
  -H "X-App-Id: fa_XXXXXXXXXXXXXXXX" \\
  -d '{"username":"player123",
       "password":"Secret123","deviceId":"device-8f2a91c4"}'`}
                  />
                </div>
              </li>
              <li>
                <p className="text-[13px] font-medium text-ink">
                  4. Check the token on every protected request
                </p>
                <div className="mt-2">
                  <CodeBlock
                    lang="javascript"
                    code={`// In your game/server, before granting access:
const res = await fetch("{{BASE_URL}}/api/v1/auth/validate", {
  headers: {
    Authorization: \`Bearer \${sessionToken}\`,
    "X-App-Id": appId,
  },
});

if (!res.ok) {
  // 401 = expired or revoked, 403 = banned / expired / device mismatch.
  // Treat every failure as "do not launch".
  return denyAccess();
}

const { data } = await res.json();
console.log("welcome back", data.username);`}
                  />
                </div>
              </li>
            </ol>
          </Section>


          {/* ── Authentication ───────────────────────────────────────── */}
          <Section id="authentication" title="Authentication">
            <p>
              FastAuth has four identity realms. They use different credentials
              and <strong>cannot be used interchangeably</strong> — a customer
              session will never open the operator console, an end-user token
              will never manage applications, and an API key will never
              authenticate a player.
            </p>

            <div className="mt-4 overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[620px] text-left">
                <thead className="border-b border-line bg-surface-850">
                  <tr>
                    <th className="table-head">Realm</th>
                    <th className="table-head">Credential</th>
                    <th className="table-head">Used by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  <tr>
                    <td className="table-cell">End user</td>
                    <td className="table-cell font-mono text-[12px]">
                      Authorization: Bearer &lt;sessionToken&gt;
                    </td>
                    <td className="table-cell text-ink-muted">
                      Your game, desktop app or launcher
                    </td>
                  </tr>
                  <tr>
                    <td className="table-cell">API key</td>
                    <td className="table-cell font-mono text-[12px]">X-Api-Key: fak_…</td>
                    <td className="table-cell text-ink-muted">
                      Your backend, provisioning scripts, CI
                    </td>
                  </tr>
                  <tr>
                    <td className="table-cell">Customer</td>
                    <td className="table-cell font-mono text-[12px]">fa_session cookie</td>
                    <td className="table-cell text-ink-muted">
                      The dashboard
                    </td>
                  </tr>
                  <tr>
                    <td className="table-cell">Operator</td>
                    <td className="table-cell font-mono text-[12px]">fa_admin_session cookie</td>
                    <td className="table-cell text-ink-muted">Platform administration only</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="mt-4">
              Both cookies are <Code>httpOnly</Code> and <Code>SameSite</Code>, so
              browser JavaScript cannot read them and they are not sent on
              cross-site requests. Never put a session token in{" "}
              <Code>localStorage</Code>.
            </p>

            <div className="mt-4 rounded-lg border border-line bg-surface-850 p-3.5">
              <p className="text-[13px] font-medium text-ink">Response envelope</p>
              <p className="mt-1 text-[13px] text-ink-muted">
                Every endpoint answers in exactly one of two shapes. Branch on{" "}
                <Code>error</Code>, never on <Code>message</Code>.
              </p>
              <div className="mt-3">
                <CodeBlock
                  lang="json"
                  code={`// success
{ "success": true, "data": { "sessionToken": "…" } }

// failure
{ "success": false, "error": "ACCOUNT_EXPIRED", "message": "Account has expired." }`}
                />
              </div>
            </div>
          </Section>


          {/* ── Core concepts ────────────────────────────────────────── */}
          <Section id="concepts" title="Core concepts">
            <div className="space-y-3">
              <div className="rounded-lg border border-line bg-surface-900 p-4">
                <p className="text-[14px] font-medium text-ink">Expiry</p>
                <p className="mt-1 text-[13px] text-ink-muted">
                  <Code>expiresAt</Code> is an absolute ISO-8601 instant, not a day
                  counter. <Code>null</Code> means the licence never expires. Once
                  it has passed, login is refused with <Code>ACCOUNT_EXPIRED</Code>.
                  Extending can continue from <Code>now</Code> or from the{" "}
                  <Code>previous</Code> expiry, which restores an expired licence for
                  its full remaining term.
                </p>
              </div>

              <div className="rounded-lg border border-line bg-surface-900 p-4">
                <p className="text-[14px] font-medium text-ink">Device limits</p>
                <p className="mt-1 text-[13px] text-ink-muted">
                  Each user has a <Code>maxDevices</Code> allowance. The first login
                  on a new <Code>deviceId</Code> consumes a seat; later logins on the
                  same id do not. A third device on an allowance of two is rejected
                  with <Code>DEVICE_LIMIT_REACHED</Code>.
                </p>
                <p className="mt-2 text-[13px] text-ink-subtle">
                  Be aware: <Code>deviceId</Code> is supplied by your client, so a
                  modified client can claim any value. This is a seat-control
                  mechanism, not tamper-proof hardware attestation.
                </p>
              </div>

              <div className="rounded-lg border border-line bg-surface-900 p-4">
                <p className="text-[14px] font-medium text-ink">Stopping an app</p>
                <p className="mt-1 text-[13px] text-ink-muted">
                  The owner can stop an entire application from the dashboard. Every
                  <Code> /api/v1</Code> call is then refused with{" "}
                  <Code>503 APP_SUSPENDED</Code> — new logins{" "}
                  <em>and</em> already-issued sessions. Nothing is deleted, so
                  starting it again restores service instantly.
                </p>
              </div>

              <div className="rounded-lg border border-line bg-surface-900 p-4">
                <p className="text-[14px] font-medium text-ink">Sessions</p>
                <p className="mt-1 text-[13px] text-ink-muted">
                  Tokens last 30 days and can be extended with{" "}
                  <Code>POST /api/v1/auth/refresh</Code>, up to a 90-day ceiling per
                  session. A user may hold 20 live sessions at once, and can see and
                  revoke their own from the client.
                </p>
              </div>

              <div className="rounded-lg border border-line bg-surface-900 p-4">
                <p className="text-[14px] font-medium text-ink">Bans</p>
                <p className="mt-1 text-[13px] text-ink-muted">
                  A banned user is refused with <Code>ACCOUNT_BANNED</Code> before
                  any device seat is consumed. Bans carry a reason and, by default,
                  revoke that user&apos;s live sessions.
                </p>
              </div>

              <div className="rounded-lg border border-line bg-surface-900 p-4">
                <p className="text-[14px] font-medium text-ink">Tenancy</p>
                <p className="mt-1 text-[13px] text-ink-muted">
                  Each application is an isolated tenant. The same username can
                  exist in two applications as two unrelated accounts, and
                  requesting another account&apos;s application id returns{" "}
                  <Code>404</Code> — never their data.
                </p>
              </div>
            </div>
          </Section>

          {/* ── Public API ───────────────────────────────────────────── */}
          <Section id="public-api" title={group("v1").label}>
            <p>{group("v1").blurb}</p>
            <div className="mt-4">
              {v1.map((endpoint) => (
                <EndpointCard key={endpoint.id} endpoint={endpoint} />
              ))}
            </div>
          </Section>


          {/* ── API keys ─────────────────────────────────────────────── */}
          <Section id="api-keys" title={group("keys").label}>
            <p>{group("keys").blurb}</p>
            <div className="mt-4 rounded-lg border border-line bg-surface-900 p-4">
              <p className="text-[14px] font-medium text-ink">Two scopes, one header</p>
              <div className="mt-3 overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[520px] text-left">
                  <thead className="border-b border-line bg-surface-850">
                    <tr>
                      <th className="table-head">Scope</th>
                      <th className="table-head">Reaches</th>
                      <th className="table-head">Issued with</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    <tr>
                      <td className="table-cell font-mono text-[12px]">platform</td>
                      <td className="table-cell text-ink-muted">
                        Every application: list, create, edit, start/stop, rotate, delete
                      </td>
                      <td className="table-cell font-mono text-[11px] text-ink-subtle">
                        --scope=platform
                      </td>
                    </tr>
                    <tr>
                      <td className="table-cell font-mono text-[12px]">app</td>
                      <td className="table-cell text-ink-muted">
                        One application&apos;s users and devices — and nothing else
                      </td>
                      <td className="table-cell font-mono text-[11px] text-ink-subtle">
                        --scope=app --app=&lt;id&gt;
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[13px] text-ink-muted">
                Keys are issued only by{" "}
                <Code>npm run create-api-key</Code> and are shown{" "}
                <strong>once</strong> — just the hash is stored. There is no HTTP
                endpoint that can create one, for the same reason there is none
                that can create an administrator. Revoke with{" "}
                <Code>--revoke=&lt;id&gt;</Code> or list them with{" "}
                <Code>--list</Code>.
              </p>
              <p className="mt-3 text-[13px] text-ink-muted">
                The <Code>appId</Code> in these paths is the Mongo ObjectId (not the
                public <Code>fa_…</Code> id), and it is only ever a lookup key —
                authority always comes from the key itself, so editing the path can
                only ever cause a refusal, never wider access.
              </p>
            </div>
            <div className="mt-4">
              {keys.map((endpoint) => (
                <EndpointCard key={endpoint.id} endpoint={endpoint} />
              ))}
            </div>
          </Section>


          {/* ── Dashboard API ────────────────────────────────────────── */}
          <Section id="dashboard-api" title={group("dashboard").label}>
            <p>{group("dashboard").blurb}</p>
            <div className="mt-4">
              {dashboard.map((endpoint) => (
                <EndpointCard key={endpoint.id} endpoint={endpoint} />
              ))}
            </div>
          </Section>

          {/* ── End-user portal API ──────────────────────────────────── */}
          <Section id="end-user-portal-api" title={group("portal").label}>
            <p>{group("portal").blurb}</p>
            <div className="mt-4 rounded-lg border border-info-500/30 bg-info-900/30 px-3.5 py-2.5">
              <p className="text-[13px] text-info-400">
                These power the page at{" "}
                <Code>/apps/&lt;appId&gt;/dashboard</Code>, where one of your own
                end users signs in. They are authenticated by an httpOnly
                <Code>fa_app_session</Code> cookie and are scoped to that
                session&apos;s own account — there is no user id in any path.
              </p>
            </div>
            <div className="mt-4">
              {portal.map((endpoint) => (
                <EndpointCard key={endpoint.id} endpoint={endpoint} />
              ))}
            </div>
          </Section>

          {/* ── Operator API ─────────────────────────────────────────── */}
          <Section id="operator-api" title={group("admin").label}>
            <p>{group("admin").blurb}</p>
            <div className="mt-4 rounded-lg border border-warn-500/30 bg-warn-900/30 px-3.5 py-2.5">
              <p className="text-[13px] text-warn-400">
                Administrators are provisioned only via{" "}
                <Code>npm run create-admin</Code>. There is no HTTP endpoint that
                can create one, and a customer session can never reach these routes.
              </p>
            </div>
            <div className="mt-4">
              {admin.map((endpoint) => (
                <EndpointCard key={endpoint.id} endpoint={endpoint} />
              ))}
            </div>
          </Section>


          {/* ── Error codes ──────────────────────────────────────────── */}
          <Section id="errors" title="Error codes">
            <p>
              The <Code>error</Code> field is a stable, machine-readable code.
              Match on these values — never on the human-facing{" "}
              <Code>message</Code>, which may change.
            </p>
            <div className="mt-4 overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[560px] text-left">
                <thead className="border-b border-line bg-surface-850">
                  <tr>
                    <th className="table-head">Status</th>
                    <th className="table-head">Code</th>
                    <th className="table-head">Meaning</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ERROR_CODES.map((error) => (
                    <tr key={error.code}>
                      <td className="table-cell tnum font-mono text-[12px] text-danger-400">
                        {error.status}
                      </td>
                      <td className="table-cell font-mono text-[12px] text-ink">
                        {error.code}
                      </td>
                      <td className="table-cell text-[13px] text-ink-muted">
                        {error.meaning}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-[13px] text-ink-muted">
              Validation failures add a <Code>details</Code> object mapping field
              names to messages, so you can highlight the offending input.
            </p>
          </Section>

          {/* ── Rate limits ──────────────────────────────────────────── */}
          <Section id="rate-limits" title="Rate limits">
            <p>
              Repeated failures are throttled to blunt credential stuffing. A
              throttled request returns <Code>429 RATE_LIMITED</Code>.
            </p>
            <div className="mt-4 overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[560px] text-left">
                <thead className="border-b border-line bg-surface-850">
                  <tr>
                    <th className="table-head">Scope</th>
                    <th className="table-head">Window</th>
                    <th className="table-head">Default</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[
                    ["End-user login", "per appId + ip + username", "10 / 5 min"],
                    ["Customer login & signup", "per ip", "10 / 10 min"],
                    ["Operator login", "per ip + identifier", "5 / 15 min"],
                  ].map(([scope, key, value]) => (
                    <tr key={scope}>
                      <td className="table-cell text-[13px]">{scope}</td>
                      <td className="table-cell text-[13px] text-ink-muted">{key}</td>
                      <td className="table-cell tnum font-mono text-[12px] text-ink-muted">
                        {value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-[13px] text-ink-muted">
              A successful login clears the caller&apos;s bucket, so a legitimate
              user is never punished for earlier typos.
            </p>
          </Section>

          {/* ── Plans ────────────────────────────────────────────────── */}
          <Section id="plans" title="Plans and limits">
            <p>
              A subscription plan caps how many applications one account may own.
              The cap is enforced on the server, so it applies whether the request
              comes from the dashboard UI or directly from the API.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {plans.map((plan) => (
                <div
                  key={plan.id}
                  className="rounded-lg border border-line bg-surface-900 p-4"
                >
                  <div className="flex items-baseline justify-between">
                    <p className="text-[14px] font-semibold text-ink">{plan.label}</p>
                    <p className="text-[12px] text-ink-subtle">{plan.priceLabel}</p>
                  </div>
                  <p className="tnum mt-2 text-xl font-semibold text-ink">
                    {plan.appLimit === null ? "∞" : plan.appLimit}
                  </p>
                  <p className="text-[12px] text-ink-subtle">
                    application{plan.appLimit === 1 ? "" : "s"}
                  </p>
                  <p className="mt-2 text-[12px] text-ink-muted">{plan.tagline}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[13px] text-ink-muted">
              Exceeding the cap returns <Code>403 APP_LIMIT_REACHED</Code>. A
              downgrade never deletes anything — existing applications keep
              working, but no new one can be created until the account is back
              under its limit.
            </p>
          </Section>
          </main>
        </div>
      </div>
    </div>
  );
}
