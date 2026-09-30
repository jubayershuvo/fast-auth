import { check, section, call, Session } from "../harness.mjs";

/**
 * Phase 12 — social sign-in.
 *
 * Drives the REAL authorization-code + PKCE flow against a local fake provider,
 * so the redirect, code exchange, profile fetch, account linking and session
 * creation are all genuinely exercised.
 */
export async function phase12OAuth(ctx) {
  section("Phase 12 — OAuth: provider management");
  const BASE = "http://127.0.0.1:4311";

  // Phase 11 signed the operator out, so start a fresh admin session here.
  const admin = new Session();
  ctx.admin = admin;
  const signedIn = await call(admin, "POST", "/api/admin/auth/login", {
    identifier: "root", password: "RootAdmin1",
  });
  check("operator re-authenticated for the OAuth phase", signedIn.status === 200,
    `got ${signedIn.status}`);

  // ── 1. Defaults: nothing enabled, nothing rendered ────────────────────
  let r = await call(admin, "GET", "/api/admin/oauth/providers");
  check("operator can list providers", r.status === 200, `got ${r.status}`);
  const providers = r.body.data?.providers ?? [];
  check("google, github and azure are all present",
    ["google", "github", "azure"].every((id) => providers.some((p) => p.provider === id)),
    JSON.stringify(providers.map((p) => p.provider)));
  check("no provider is enabled by default",
    providers.every((p) => p.enabled === false), "a provider was enabled by default");
  check("a fresh config exposes no client id",
    providers.every((p) => p.clientId === null), "a client id leaked by default");

  const anon = new Session();
  r = await call(anon, "GET", "/api/admin/oauth/providers");
  check("a non-operator cannot read the provider config", r.status === 401, `got ${r.status}`);

  // ── 2. Guard: cannot enable admin sign-in without a secret ────────────
  r = await call(admin, "PATCH", "/api/admin/oauth/providers", {
    provider: "google", enabled: true, allowAdminLogin: true,
  });
  check("enabling admin OAuth without credentials is refused (400)",
    r.status === 400, `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

  // ── 3. Save credentials, and prove the secret is never returned ────────
  const SECRET = "super-secret-client-value";
  r = await call(admin, "PATCH", "/api/admin/oauth/providers", {
    provider: "google", clientId: "test-client-id-123", clientSecret: SECRET,
    enabled: true, allowCustomerLogin: true,
  });
  check("credentials save successfully", r.status === 200, JSON.stringify(r.body).slice(0, 150));
  check("the response reports a stored secret", r.body.data?.provider?.hasSecret === true,
    JSON.stringify(r.body.data?.provider));

  r = await call(admin, "GET", "/api/admin/oauth/providers");
  const google = r.body.data.providers.find((p) => p.provider === "google");
  check("the client SECRET is never returned by the API",
    !JSON.stringify(r.body).includes(SECRET), "the plaintext secret was returned!");
  check("the client id is returned for display", google.clientId === "test-client-id-123",
    String(google.clientId));
  check("a masked secret hint is shown instead", google.hasSecret === true);

  // ── 4. Disabled providers are invisible ────────────────────────────────
  const loginHtml = await (await fetch(`${BASE}/login`)).text();
  check("an enabled+configured provider appears on the sign-in page",
    loginHtml.includes("/api/auth/oauth/google/start"), "google button missing");
  check("a provider that is not configured does NOT appear",
    !loginHtml.includes("/api/auth/oauth/github/start"), "github button leaked");

  // ── 5. The real PKCE round trip against the fake provider ────────────
  // Reuse the mock the SERVER was configured against (started in verify.mjs).
  // Starting a new one here would bind a different port the app never calls.
  const mock = ctx.mockProvider;
  if (!mock) throw new Error("mock provider missing from ctx");

  mock.state.authRequests.length = 0;
  mock.state.tokenRequests.length = 0;
  mock.state.rejectToken = false;
  mock.state.profile = {
    sub: "mock-subject-1",
    email: "oauth.user@example.com",
    email_verified: true,
    name: "OAuth User",
    picture: null,
  };

  await runFullFlow(ctx, mock);
}

/**
 * Follow a redirect chain hop-by-hop, carrying cookies the way a browser does.
 *
 * `fetch(..., { redirect: "follow" })` cannot be used here: the spec strips a
 * manually-set `Cookie` header on a cross-origin redirect, so the PKCE state
 * cookie would be dropped on the leg back from the provider. This walks the
 * chain itself, absorbing `Set-Cookie` at every hop.
 */
async function follow(session, startUrl) {
  let url = startUrl;
  for (let hop = 0; hop < 10; hop += 1) {
    // Path matters: the PKCE state cookie is scoped to "/api/auth/oauth", so it
    // must be matched against the actual request path or the callback cannot
    // find it and the flow dies with `state_expired`.
    const response = await fetch(url, {
      headers: { Cookie: session.header(new URL(url).pathname) },
      redirect: "manual",
    });
    session.absorb(response);

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url).toString();
      continue;
    }
    return { status: response.status, url, html: await response.text() };
  }
  return { status: 0, url, html: "" };
}

async function runFullFlow(ctx, mock) {
  section("Phase 12b — OAuth: full PKCE flow (fake provider)");

  // The server was started with OAUTH_TEST_* pointing at this mock, so this
  // exercises the real code path: /start -> provider -> /callback -> session.
  const customer = new Session();

  // 1. Kick off the flow. The app redirects to the mock's /authorize.
  const start = await follow(customer, "http://127.0.0.1:4311/api/auth/oauth/google/start");
  check("the OAuth round trip lands on the dashboard",
    start.url.includes("/dashboard"), `landed on ${start.url}`);

  check("the provider was actually asked for authorization",
    mock.state.authRequests.length === 1,
    `${mock.state.authRequests.length} auth requests`);

  const authRequest = mock.state.authRequests[0] ?? {};
  check("PKCE was used (S256)", authRequest.method === "S256", String(authRequest.method));
  check("a code_challenge was sent", typeof authRequest.challenge === "string"
    && authRequest.challenge.length >= 43, String(authRequest.challenge));
  check("state was sent and is long enough to be unguessable",
    (authRequest.state ?? "").length >= 32, String(authRequest.state));
  check("the callback URL points at the customer route",
    (authRequest.redirectUri ?? "").endsWith("/api/auth/oauth/google/callback"),
    String(authRequest.redirectUri));

  check("the token exchange happened server-side",
    mock.state.tokenRequests.length === 1,
    `${mock.state.tokenRequests.length} token requests`);
  const tokenRequest = mock.state.tokenRequests[0] ?? {};
  check("the PKCE verifier was sent to the token endpoint",
    typeof tokenRequest.verifier === "string" && tokenRequest.verifier.length >= 32,
    String(tokenRequest.verifier).slice(0, 20));
  check("the client secret was sent server-side",
    tokenRequest.clientSecret === "super-secret-client-value", "secret not forwarded");
  check("the client secret never appeared in a browser URL",
    !start.url.includes("super-secret"), "secret leaked into the URL");

  // 2. A dashboard session now exists for the auto-provisioned user.
  const me = await call(customer, "GET", "/api/auth/me");
  check("the OAuth user has a real dashboard session",
    me.status === 200 && me.body.data?.email === "oauth.user@example.com",
    JSON.stringify(me.body));
  check("the OAuth account was auto-provisioned",
    me.body.data?.username === "oauth.user", String(me.body.data?.username));

  // 3. Signing in again must reuse the SAME account, not duplicate it.
  mock.state.authRequests.length = 0;
  const second = new Session();
  const again = await follow(second, "http://127.0.0.1:4311/api/auth/oauth/google/start");
  check("a second OAuth sign-in succeeds", again.url.includes("/dashboard"), again.url);
  const secondMe = await call(second, "GET", "/api/auth/me");
  check("the second sign-in reuses the same account (no duplicate)",
    secondMe.body.data?.id === me.body.data?.id,
    `${secondMe.body.data?.id} vs ${me.body.data?.id}`);

  // 4. A forged state must be rejected (CSRF protection).
  const csrf = new Session();
  const forged = await follow(
    csrf,
    "http://127.0.0.1:4311/api/auth/oauth/google/callback?code=anything&state=forged-state",
  );
  check("a callback with a forged state is rejected",
    forged.url.includes("/login"), `landed on ${forged.url}`);
  const forgedMe = await call(csrf, "GET", "/api/auth/me");
  check("the forged callback created no session", forgedMe.status === 401, `got ${forgedMe.status}`);

  // 5. A provider-side failure must not sign anyone in.
  mock.state.rejectToken = true;
  const failing = new Session();
  const failed = await follow(failing, "http://127.0.0.1:4311/api/auth/oauth/google/start");
  check("a rejected token exchange does not sign the user in",
    failed.url.includes("/login"), `landed on ${failed.url}`);
  const failedMe = await call(failing, "GET", "/api/auth/me");
  check("no session was created on token failure", failedMe.status === 401, `got ${failedMe.status}`);
  mock.state.rejectToken = false;

  // 6. An unverified email must NOT auto-link to an existing account.
  mock.state.profile = {
    sub: "attacker-subject",
    email: "owner@example.com", // an account that already exists
    email_verified: false, // ...but the provider does not vouch for it
    name: "Attacker",
  };
  const attacker = new Session();
  const attack = await follow(attacker, "http://127.0.0.1:4311/api/auth/oauth/google/start");
  check("an unverified email does not hijack the existing account",
    attack.url.includes("/login"), `landed on ${attack.url}`);
  const attackMe = await call(attacker, "GET", "/api/auth/me");
  check("the unverified-email attacker is not signed in as the victim",
    attackMe.status === 401, `got ${attackMe.status}`);

  // 7. The same unverified email creates a SEPARATE account, not a takeover.
  check("an unverified email cannot assume the victim's identity",
    attackMe.body?.data?.email !== "owner@example.com" || attackMe.status === 401,
    "the victim's account was reached");

  mock.state.profile = {
    sub: "mock-subject-1",
    email: "oauth.user@example.com",
    email_verified: true,
    name: "OAuth User",
  };
}

/**
 * Phase 13 — admin OAuth must NEVER auto-provision.
 *
 * This is the single most important guarantee in the OAuth feature. If any
 * unknown Google account could become a platform administrator, then flipping
 * the "Admin sign-in" toggle would hand platform-wide access to the internet.
 */
export async function phase13AdminOAuth(ctx) {
  section("Phase 13 — admin OAuth: no auto-provisioning");
  const { admin } = ctx;
  const mock = ctx.mockProvider;

  // Enable google for the admin realm, with credentials.
  let r = await call(admin, "PATCH", "/api/admin/oauth/providers", {
    provider: "google",
    clientId: "test-client-id-123",
    clientSecret: "super-secret-client-value",
    enabled: true,
    allowAdminLogin: true,
  });
  check("admin OAuth can be enabled once credentials exist", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 150)}`);

  const adminLogin = await (await fetch("http://127.0.0.1:4311/admin/login")).text();
  check("the provider now appears on the admin sign-in page",
    adminLogin.includes("/api/admin/oauth/google/start"), "admin google button missing");

  // An UNKNOWN Google identity must be refused outright.
  mock.state.profile = {
    sub: "stranger-subject",
    email: "stranger@not-an-admin.test",
    email_verified: true,
    name: "Total Stranger",
  };

  const stranger = new Session();
  const attempt = await follow(stranger, "http://127.0.0.1:4311/api/admin/oauth/google/start");
  check("an unknown identity cannot sign in as an administrator",
    attempt.url.includes("/admin/login"), `landed on ${attempt.url}`);

  const strangerMe = await call(stranger, "GET", "/api/admin/auth/me");
  check("the stranger has no admin session", strangerMe.status === 401, `got ${strangerMe.status}`);

  const strangerPage = await fetch("http://127.0.0.1:4311/admin", {
    headers: { Cookie: stranger.header() },
    redirect: "manual",
  });
  check("the stranger cannot open the admin panel",
    strangerPage.status === 307 || strangerPage.status === 302,
    `got ${strangerPage.status}`);

  // A PRE-EXISTING admin with a verified email CAN use it.
  // The root admin was created with email root@fastauth.test, so match that.
  mock.state.profile = {
    sub: "root-subject",
    email: "root@fastauth.test",
    email_verified: true,
    name: "Root",
  };

  const realAdmin = new Session();
  const ok = await follow(realAdmin, "http://127.0.0.1:4311/api/admin/oauth/google/start");
  check("a pre-provisioned admin CAN sign in with OAuth", ok.url.endsWith("/admin"),
    `landed on ${ok.url}`);

  const adminMe = await call(realAdmin, "GET", "/api/admin/auth/me");
  check("the OAuth admin session is valid",
    adminMe.status === 200 && adminMe.body.data?.username === "root",
    JSON.stringify(adminMe.body));

  // The admin OAuth session must NOT work as a customer session.
  const asCustomer = await call(realAdmin, "GET", "/api/auth/me");
  check("an admin OAuth session cannot act as a customer", asCustomer.status === 401,
    `got ${asCustomer.status}`);

  // Turn admin OAuth back off so later phases are unaffected.
  r = await call(admin, "PATCH", "/api/admin/oauth/providers", {
    provider: "google", allowAdminLogin: false,
  });
  check("admin OAuth can be switched back off", r.status === 200, `got ${r.status}`);

  mock.state.profile = {
    sub: "mock-subject-1",
    email: "oauth.user@example.com",
    email_verified: true,
    name: "OAuth User",
  };
}
