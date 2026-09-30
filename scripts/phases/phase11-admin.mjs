import { check, section, call, Session } from "../harness.mjs";

/**
 * Phase 11 — operator back-office.
 *
 * The most important assertions here are the NEGATIVE ones: they prove the
 * admin panel cannot be reached with a customer session, that a customer
 * session cannot impersonate an admin, and that the admin cookie cannot be
 * used to reach the customer dashboard.
 */
export async function phase11Admin(ctx) {
  section("Phase 11 — admin panel: isolation");
  const BASE = "http://127.0.0.1:4311";
  const { owner, app } = ctx;

  // ── 1. No admin exists yet ────────────────────────────────────────────
  let r = await call(null, "POST", "/api/admin/auth/login", {
    identifier: "root", password: "Whatever1",
  });
  check("admin login fails when no administrator exists", r.status === 401, `got ${r.status}`);

  // ── 2. A customer session must NOT unlock /admin ──────────────────────
  const pageRes = await fetch(`${BASE}/admin`, {
    headers: { Cookie: owner.header() },
    redirect: "manual",
  });
  check("a customer session cannot open the admin panel",
    pageRes.status === 307 || pageRes.status === 302,
    `got ${pageRes.status}`);
  check("the redirect goes to /admin/login, not /dashboard",
    (pageRes.headers.get("location") ?? "").includes("/admin/login"),
    pageRes.headers.get("location") ?? "none");

  r = await call(owner, "GET", "/api/admin/auth/me");
  check("a customer session gets 401 from the admin API", r.status === 401, `got ${r.status}`);

  // ── 3. Bootstrap an admin via the CLI (the only supported path) ────────
  const { spawnSync } = await import("node:child_process");
  const created = spawnSync(
    "node",
    ["scripts/create-admin.mjs", "--email=root@fastauth.test", "--username=root",
     "--password=RootAdmin1"],
    { env: { ...process.env, MONGODB_URI: ctx.uri }, encoding: "utf8" },
  );
  check("create-admin CLI succeeds", created.status === 0,
    (created.stdout || created.stderr || "").slice(0, 200));

  const dup = spawnSync(
    "node",
    ["scripts/create-admin.mjs", "--email=root@fastauth.test", "--username=root2",
     "--password=RootAdmin1"],
    { env: { ...process.env, MONGODB_URI: ctx.uri }, encoding: "utf8" },
  );
  check("create-admin rejects a duplicate email", dup.status !== 0, "duplicate was allowed");

  // ── 4. Admin authentication ───────────────────────────────────────────
  const admin = new Session();
  r = await call(admin, "POST", "/api/admin/auth/login", {
    identifier: "root", password: "RootAdmin1",
  });
  check("admin login succeeds with correct credentials", r.status === 200,
    JSON.stringify(r.body).slice(0, 200));

  r = await call(admin, "GET", "/api/admin/auth/me");
  check("admin /me returns the operator identity",
    r.status === 200 && r.body.data.username === "root", JSON.stringify(r.body));

  // ── 4b. The cookie must actually REACH the API it authenticates ────────
  // Regression guard. The admin realm spans /admin/* (pages) and /api/admin/*
  // (API). A cookie scoped to "/admin" renders the panel fine but is never sent
  // to the API, so every call 401s with "Administrator sign-in required" while
  // the user is visibly signed in. Assert the real browser rule, not just that
  // the cookie exists.
  const adminCookie = admin.all("fa_admin_session").find((c) => c.path === "/");
  check("the admin session cookie is stored", Boolean(adminCookie),
    "fa_admin_session was never set");
  check("the admin cookie is sent to the /api/admin API",
    admin.matches(adminCookie?.path ?? "/x", "/api/admin/oauth/providers"),
    `Path=${adminCookie?.path} does not match the API`);
  check("the admin cookie is sent to the /admin pages",
    admin.matches(adminCookie?.path ?? "/x", "/admin/settings/auth-methods"),
    `Path=${adminCookie?.path} does not match the pages`);
  check("signing in issues the cookie at the root path",
    admin.all("fa_admin_session").every((c) => c.path === "/"),
    admin.all("fa_admin_session").map((c) => c.path).join(","));
  r = await call(admin, "GET", "/api/admin/oauth/providers");
  check("an operator can read the OAuth provider settings", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

  // ── 4c. Re-login must heal a browser still holding the OLD cookie ───────
  // Browsers key cookies by (name, domain, path), so a pre-fix Path=/admin
  // copy survives the upgrade as a SECOND cookie that still matches /admin/*
  // (page renders) but not /api/admin/* (every call 401s). Re-login must
  // expire it. Model exactly that: a jar seeded with the legacy cookie.
  const stale = new Session();
  stale.absorb({
    headers: {
      getSetCookie: () => [
        "fa_admin_session=legacy-token-value; Path=/admin; HttpOnly; SameSite=Strict",
      ],
    },
  });
  check("the legacy cookie is scoped to /admin and misses the API",
    !stale.matches("/admin", "/api/admin/oauth/providers"),
    "the legacy cookie should NOT reach the API");

  r = await call(stale, "POST", "/api/admin/auth/login", {
    identifier: "root", password: "RootAdmin1",
  });
  check("re-login succeeds with a stale cookie present", r.status === 200,
    `got ${r.status}`);

  r = await call(stale, "GET", "/api/admin/oauth/providers");
  check("after re-login the stale cookie no longer shadows the session",
    r.status === 200, `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

  // Signing out must revoke the LEGACY session too, not just the cookie the
  // server happens to read first — otherwise an operator who believes they
  // signed out still has a working session in the browser.
  const legacyToken = stale.all("fa_admin_session")
    .find((c) => c.path === "/admin")?.value;
  check("the legacy cookie is still present before sign-out",
    Boolean(legacyToken), "no legacy cookie to test");

  r = await call(stale, "POST", "/api/admin/auth/logout");
  check("sign-out succeeds", r.status === 200, `got ${r.status}`);

  // Re-present the exact pre-sign-out legacy cookie, bypassing the jar, to
  // prove the server-side session behind it is gone.
  if (legacyToken) {
    const replay = await call(
      new (await import("../harness.mjs")).Session(),
      "GET", "/api/admin/auth/me",
      undefined,
      { Cookie: `fa_admin_session=${legacyToken}` },
    );
    check("a legacy cookie cannot be replayed after sign-out", replay.status === 401,
      `got ${replay.status}`);
  }

  const anon = new Session();
  r = await call(anon, "POST", "/api/admin/auth/login", {
    identifier: "root", password: "WrongPassword1",
  });
  check("admin login with a wrong password is 401", r.status === 401, `got ${r.status}`);
  r = await call(anon, "POST", "/api/admin/auth/login", {
    identifier: "ghost", password: "WrongPassword1",
  });
  check("admin login for a non-existent operator gives the same generic error",
    r.status === 401 && r.body.error === "INVALID_CREDENTIALS", JSON.stringify(r.body));

  // ── 5. Cross-namespace cookie checks ──────────────────────────────────
  r = await call(admin, "GET", "/api/auth/me");
  check("an admin cookie cannot act as a customer session", r.status === 401, `got ${r.status}`);

  r = await call(owner, "GET", "/api/admin/auth/me");
  check("a customer cookie cannot act as an admin session", r.status === 401, `got ${r.status}`);

  const asAdminPage = await fetch(`${BASE}/dashboard`, {
    headers: { Cookie: admin.header() },
    redirect: "manual",
  });
  check("an admin cookie cannot open the customer dashboard",
    asAdminPage.status === 307 || asAdminPage.status === 302,
    `got ${asAdminPage.status}`);
  check("that redirect targets /login",
    (asAdminPage.headers.get("location") ?? "").includes("/login"),
    asAdminPage.headers.get("location") ?? "none");

  // ── 6. Cross-tenant visibility ────────────────────────────────────────
  const { player2 } = ctx;
  section("Phase 11b — admin panel: cross-tenant visibility");

  const getPage = async (path) => {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Cookie: admin.header() },
      redirect: "manual",
    });
    const html = await res.text();
    return {
      status: res.status,
      text: html
        .replace(/<script[\s\S]*?<\/script>/g, " ")
        .replace(/<style[\s\S]*?<\/style>/g, " ")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\s+/g, " "),
    };
  };

  const pages = [
    ["/admin", "Platform overview"],
    ["/admin/customers", "Every dashboard account"],
    ["/admin/applications", "All customer applications"],
    ["/admin/app-users", "All end-user licences"],
    ["/admin/devices", "All registered devices"],
    ["/admin/sessions", "All end-user sessions"],
    ["/admin/logs", "authentication event"],
  ];
  for (const [path, needle] of pages) {
    const res = await getPage(path);
    check(`admin ${path} renders (${res.status})`,
      res.status === 200 && res.text.includes(needle),
      `status=${res.status} missing "${needle}"`);
  }

  // The whole point: the operator sees BOTH tenants' data in one view.
  const customers = await getPage("/admin/customers");
  check("the admin sees the first customer's email",
    customers.text.includes("owner@example.com"));
  check("the admin sees the second customer's email",
    customers.text.includes("intruder@example.com"));

  const applications = await getPage("/admin/applications");
  check("the admin sees both applications", applications.text.includes("MyGame v2"),
    "MyGame missing");
  check("the admin sees app ids across tenants",
    applications.text.includes(app.appId.slice(0, 12)), "appId missing");

  const appUsers = await getPage("/admin/app-users");
  check("the admin sees application users from both applications",
    appUsers.text.includes("player123"), "player123 missing");
  check("the admin sees users from the second tenant's app",
    appUsers.text.includes(player2.username), `${player2.username} missing`);

  const logs = await getPage("/admin/logs");
  check("the admin sees platform-wide audit events", logs.text.includes("LOGIN"));

  // ── Secrets must never be visible, even to the operator ───────────────
  const applicationPage = await getPage("/admin/applications");
  check("the admin applications page never renders a secret",
    !applicationPage.text.includes("fas_"), "an app secret leaked into the admin UI");
  check("the admin applications page never renders a password hash",
    !applicationPage.text.includes("$2b$"), "a bcrypt hash leaked into the admin UI");

  const usersPage = await getPage("/admin/customers");
  check("the admin customers page never renders a password hash",
    !usersPage.text.includes("$2b$"), "a bcrypt hash leaked into the admin UI");

  // ── Admin sign-out invalidates the session ────────────────────────────
  r = await call(admin, "POST", "/api/admin/auth/logout");
  check("admin logout succeeds", r.status === 200, JSON.stringify(r.body));
  r = await call(admin, "GET", "/api/admin/auth/me");
  check("the admin session is dead after logout", r.status === 401, `got ${r.status}`);
}
