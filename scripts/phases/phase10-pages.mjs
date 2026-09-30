import { check, section, call, registerAndVerify, Session } from "../harness.mjs";

/**
 * Reduce a server-rendered page to its visible text.
 *
 * Two things get in the way of naive substring matching:
 *  1. `<script>` blocks carry the escaped RSC flight payload, which contains
 *     the same words in a different form and would match first.
 *  2. React inserts `<!-- -->` between adjacent text nodes when it
 *     interpolates, splitting phrases like "0 devices registered".
 */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Phase 10 — dashboard pages render.
 *
 * The API suite proves the backend; this proves the server-rendered pages
 * actually produce HTML (a broken layout or a bad `await` would otherwise only
 * surface in a browser).
 */
export async function phase10Pages(ctx) {
  section("Phase 10 — dashboard pages render");
  const { owner, app, player } = ctx;

  // Re-authenticate: phase 8 signed the owner out.
  await call(owner, "POST", "/api/auth/login", {
    identifier: "owner",
    password: "Owner123",
  });

  const get = async (path, session = owner) => {
    const response = await fetch(`http://127.0.0.1:4311${path}`, {
      headers: { Cookie: session.header() },
      redirect: "manual",
    });
    const html = await response.text();
    return { status: response.status, html, text: visibleText(html) };
  };

  // Needles are deliberately single static text nodes. Interpolated copy
  // ("{total} device{s} registered") changes with the count, and JSX code
  // comments are never rendered, so neither is a stable assertion target.
  // ── A brand-new account must be able to create its first application ────
  // Regression guard: the empty state used to REPLACE the manager, so a new
  // account was told "Create an application…" with nothing to click and no way
  // to ever get an app id. Assert the action is present when the list is empty.
  const fresh = new Session();
  const reg = await registerAndVerify(fresh, {
    email: "fresh-owner@fastauth.test",
    name: "Frank Freshowner",
    name: "Frank Freshowner",
    username: "fresh-owner",
    password: "FreshOwner1",
  });
  check("a brand-new customer can register", reg.status === 200 || reg.status === 201,
    `got ${reg.status} ${JSON.stringify(reg.body).slice(0, 120)}`);

  const freshApps = await get("/dashboard/applications", fresh);
  check("a new account sees the empty state", freshApps.text.includes("No applications yet"),
    freshApps.text.slice(0, 120));
  check("a new account is offered a way to create an application",
    freshApps.text.includes("New application"),
    "the empty state rendered no create action");
  check("the create action is not disabled for a new account",
    !/disabled[^>]*>\s*(?:<[^>]*>\s*)*New application/.test(freshApps.html),
    "the create button was rendered disabled");

  // Same trap on the end-user list: the empty state replaced the manager, so a
  // new application had no way to add its first user.
  const created = await call(fresh, "POST", "/api/dashboard/applications", {
    name: "Empty Users App", description: "no users yet",
  });
  check("a new application can be created", created.status === 200 || created.status === 201,
    `got ${created.status} ${JSON.stringify(created.body).slice(0, 120)}`);

  const freshUsers = await get(`/dashboard/applications/${created.body.data.id}/users`, fresh);
  check("a new application shows the empty user list",
    freshUsers.text.includes("No users yet"), freshUsers.text.slice(0, 120));
  check("a new application is offered a way to add an end user",
    freshUsers.text.includes("New user"),
    "the user empty state rendered no create action");

  // A search with no matches must not lose the create control either.
  const searched = await get(
    `/dashboard/applications/${created.body.data.id}/users?search=zzznope`, fresh);
  check("a search with no matches is worded as a search result",
    searched.text.includes("No users match your search"), searched.text.slice(0, 120));

  // ── Responsive contract ─────────────────────────────────────────────────
  // These lock in behaviour that is invisible in a desktop screenshot but is
  // the difference between a usable and an unusable phone layout.
  // Uses the seeded application, not the empty one above: the table only
  // renders on the populated branch, so an empty app proves nothing.
  for (const [label, path] of [
    ["devices", `/dashboard/applications/${app.id}/devices`],
    ["sessions", `/dashboard/applications/${app.id}/sessions`],
    ["logs", `/dashboard/applications/${app.id}/logs`],
    ["end users", `/dashboard/applications/${app.id}/users`],
  ]) {
    const page = await get(path, owner);
    check(`the ${label} table is inside a labelled scroll region`,
      page.html.includes('role="region"'),
      `no scroll region on ${path} — the wide table would push the page sideways`);

    // Every list that grows without bound needs a way to find a row. A GET
    // form keeps the filter in the URL, so it survives a refresh and the back
    // button, and needs no client JavaScript.
    check(`the ${label} list offers a search box`,
      page.html.includes('type="search"'),
      `no search input on ${path}`);
  }

  // Per-user device management: a dedicated page for ONE user's seats, reached
  // from that user's detail view rather than only from the app-wide list.
  const usersRes = await call(owner, "GET",
    `/api/dashboard/applications/${app.id}/users?limit=10`);
  const firstUser = usersRes.body?.data?.users?.[0];

  if (firstUser?.id) {
    const path = `/dashboard/applications/${app.id}/users/${firstUser.id}/devices`;
    const userDevices = await get(path, owner);

    check("the per-user devices page renders", userDevices.status === 200,
      `got ${userDevices.status} on ${path}`);
    check("the per-user devices page names the user it belongs to",
      userDevices.text.includes("Devices for"), "no per-user device heading");
    check("the per-user devices page reports the seat budget",
      /seats? used/.test(userDevices.text), "no seat usage shown");
    check("the per-user devices page can be searched",
      userDevices.html.includes('type="search"'), "no search on the devices page");
    check("the per-user devices page links back to the user",
      userDevices.html.includes(`/users/${firstUser.id}`), "no link back to the user");
    check("the user page links through to the per-user devices page",
      (await get(`/dashboard/applications/${app.id}/users/${firstUser.id}`, owner))
        .html.includes(`/users/${firstUser.id}/devices`),
      "no 'Manage devices' link on the user detail page");
  }

  // Long identifiers must be allowed to wrap, or one app id / user agent
  // scrolls the whole page horizontally.
  const appPage = await get(`/dashboard/applications/${app.id}`, owner);
  check("long identifiers are allowed to wrap rather than overflow",
    appPage.html.includes("break-anywhere"),
    "no break-anywhere — an app id could force page-wide horizontal scroll");

  // The docs table of contents is hidden on small screens, so the page must
  // offer another way to jump between sections.
  const docs = await fetch("http://127.0.0.1:4311/docs");
  const docsHtml = await docs.text();
  check("the docs offer section navigation for small screens",
    docsHtml.includes("Documentation sections"),
    "no mobile section navigation on /docs");

  // Regression guard. The mobile chip row was once a direct child of the  // horizontal `flex` container, so it was stretched to the full page height
  // and took a slice of the width: on a phone the chips rendered as
  // full-height columns with the prose squeezed beside them. It must be a
  // SIBLING of that row, under a plain column wrapper.
  check("the docs content wrapper is a column, not a flex row",
    docsHtml.includes("max-w-6xl px-5 sm:px-7"),
    "the max-w-6xl wrapper lost its column-only class");
  check("the docs layout no longer uses the row wrapper that broke mobile",
    !docsHtml.includes("mx-auto flex max-w-6xl gap-8"),
    "the mobile nav is back inside the horizontal flex container");
  check("the sidebar row is still a flex row inside the column",
    docsHtml.includes("flex gap-8 py-8"),
    "the table-of-contents row is missing");

  const authPages = [
    ["/dashboard", "Welcome back"],
    ["/dashboard/applications", "No applications yet|Applications"],
    [`/dashboard/applications/${app.id}`, "Quick start"],
    [`/dashboard/applications/${app.id}/users`, "New user"],
    [`/dashboard/applications/${app.id}/users/${player.id}`, "Registered devices"],
    [`/dashboard/applications/${app.id}/devices`, "First seen"],
    [`/dashboard/applications/${app.id}/sessions`, "Live sessions|Expires"],
    [`/dashboard/applications/${app.id}/logs`, "LOGIN SUCCESS|Reason"],
    ["/dashboard/settings", "Change password"],
  ];

  for (const [path, pattern] of authPages) {
    const r = await get(path);
    const needle = new RegExp(pattern);
    check(`${path} renders (${r.status})`,
      r.status === 200 && needle.test(r.text),
      `status=${r.status} missing /${pattern}/`);
  }

  // Public pages must be fetched WITHOUT a session, otherwise the proxy
  // correctly redirects a signed-in visitor to the dashboard.
  const visitor = new Session();
  for (const [path, needle] of [
    ["/login", "Sign in"],
    ["/register", "Create your account"],
    ["/", "FastAuth"],
    // `/set-password` is reached by someone who has NO password, so they are
    // necessarily signed out. If the proxy bounces them to /login, and /login
    // sends them back here, the account can never claim a password at all — so
    // this page must render anonymously. Its API routes were already public;
    // the page itself was not, and nothing here caught it.
    ["/set-password", "Set a password"],
    // Same reasoning: someone who forgot their password is signed out by
    // definition. A page missing from PUBLIC_PAGES redirects to /login, which
    // links back here — a loop nobody can escape.
    ["/forgot-password", "Reset your password"],
    // An application's own sign-in screen, at `/apps/<appId>/login`. The
    // application is in the PATH precisely so the form can ask for a username
    // and password alone; an end user never sees the customer `/login`. If this
    // stopped being public the Proxy would bounce them to a form that could
    // never authenticate them.
    [`/apps/${ctx.app.appId}/login`, "Sign in"],
  ]) {
    const r = await get(path, visitor);
    check(`${path} renders for a signed-out visitor (${r.status})`,
      r.status === 200 && r.text.includes(needle),
      `status=${r.status} missing "${needle}"`);
  }

  // A signed-in visitor hitting /login should be redirected, not re-rendered.
  const signedIn = await get("/login");
  check("a signed-in visitor is redirected away from /login",
    signedIn.status === 307 || signedIn.status === 302,
    `got ${signedIn.status}`);

  // No secret material may ever appear in rendered HTML.
  const detail = await get(`/dashboard/applications/${app.id}`);
  check("the application page never renders the app secret",
    !detail.html.includes("fas_"), "a plaintext secret leaked into the HTML");
  check("the application page never renders a password hash",
    !detail.html.includes("$2b$"), "a bcrypt hash leaked into the HTML");

  // Unauthenticated visitors are redirected, not served.
  const anon = new Session();
  const anonResponse = await fetch("http://127.0.0.1:4311/dashboard", {
    headers: { Cookie: anon.header() },
    redirect: "manual",
  });
  check("an anonymous visitor is redirected away from /dashboard",
    anonResponse.status === 307 || anonResponse.status === 302,
    `got ${anonResponse.status}`);
  check("the redirect targets /login",
    (anonResponse.headers.get("location") ?? "").includes("/login"),
    anonResponse.headers.get("location") ?? "no location header");
}
