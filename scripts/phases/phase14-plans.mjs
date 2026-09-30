import { check, section, call, registerAndVerify, Session } from "../harness.mjs";

/**
 * Phase 14 — subscription plans.
 *
 * The enforcement must be server-side: a customer who ignores the disabled
 * button (or calls the API directly) must still be refused.
 */
export async function phase14Plans(ctx) {
  section("Phase 14 — subscription plans");
  const { admin } = ctx;

  // A fresh customer, so earlier phases' applications don't skew the count.
  const session = new Session();
  let r = await registerAndVerify(session, {
    name: "Pat Plans",
    name: "Pat Plans", email: "plans@example.com", username: "plansuser", password: "PlansUser1",
  });
  // 200, not 201: the combined helper ends on the verify call.
  check("a new customer registers", r.status === 200, `got ${r.status}`);

  // `registerAndVerify` ends on the verify call, whose payload nests the user
  // under `data.user` — the id the admin plan route needs lives there.
  const customerId = r.body.data?.user?.id;
  ctx.plansCustomerId = customerId;

  // ── Default plan is Free, limit 2 ──────────────────────────────────────
  r = await call(session, "POST", "/api/dashboard/applications", { name: "App One" });
  check("free plan: 1st application is allowed", r.status === 201, `got ${r.status}`);
  r = await call(session, "POST", "/api/dashboard/applications", { name: "App Two" });
  check("free plan: 2nd application is allowed", r.status === 201, `got ${r.status}`);

  // ── Third must be refused, with the documented code ────────────────────
  r = await call(session, "POST", "/api/dashboard/applications", { name: "App Three" });
  check("free plan: 3rd application is refused with 403", r.status === 403, `got ${r.status}`);
  check("the refusal uses APP_LIMIT_REACHED",
    r.body?.error === "APP_LIMIT_REACHED", JSON.stringify(r.body));
  check("the refusal explains the limit",
    typeof r.body?.message === "string" && r.body.message.includes("2"),
    String(r.body?.message));

  r = await call(session, "GET", "/api/dashboard/applications");
  check("the blocked application was NOT created", r.body.data.applications.length === 2,
    `got ${r.body.data.applications.length}`);
  ctx.plansApps = r.body.data.applications;

  // ── A different customer is unaffected (the limit is per-account) ──────
  const other = new Session();
  await registerAndVerify(other, {
    name: "Quinn Plans",
    name: "Quinn Plans", email: "plans2@example.com", username: "plansuser2", password: "PlansUser1",
  });
  r = await call(other, "POST", "/api/dashboard/applications", { name: "Their App" });
  check("the limit is per-account, not global", r.status === 201, `got ${r.status}`);

  // ── Upgrading raises the cap ──────────────────────────────────────────
  r = await call(admin, "PATCH", `/api/admin/customers/${customerId}/plan`, {
    plan: "starter",
  });
  check("an operator can upgrade the customer to Starter", r.status === 200,
    JSON.stringify(r.body).slice(0, 150));
  check("the response reports the new plan", r.body.data?.result?.plan === "starter",
    JSON.stringify(r.body.data?.result));
  check("the response reports the new limit of 10",
    r.body.data?.result?.limit === 10, String(r.body.data?.result?.limit));

  r = await call(session, "POST", "/api/dashboard/applications", { name: "App Three" });
  check("after upgrading, the 3rd application is allowed", r.status === 201, `got ${r.status}`);

  // ── Pro and Unlimited ─────────────────────────────────────────────────
  r = await call(admin, "PATCH", `/api/admin/customers/${customerId}/plan`, { plan: "pro" });
  check("an operator can move the customer to Pro", r.status === 200, `got ${r.status}`);
  check("Pro's limit is 20", r.body.data?.result?.limit === 20,
    String(r.body.data?.result?.limit));

  r = await call(admin, "PATCH", `/api/admin/customers/${customerId}/plan`, {
    plan: "unlimited",
  });
  check("an operator can move the customer to Unlimited", r.status === 200, `got ${r.status}`);
  check("Unlimited's limit is null", r.body.data?.result?.limit === null,
    String(r.body.data?.result?.limit));
  check("Unlimited never reports overLimit",
    r.body.data?.result?.overLimit === false, String(r.body.data?.result?.overLimit));

  // ── Downgrade must NOT delete anything, only block new ones ───────────
  r = await call(admin, "PATCH", `/api/admin/customers/${customerId}/plan`, { plan: "free" });
  check("downgrading back to Free succeeds", r.status === 200, `got ${r.status}`);
  check("the downgrade is flagged as over-limit", r.body.data?.result?.overLimit === true,
    JSON.stringify(r.body.data?.result));
  check("the downgrade reports the true usage (3)", r.body.data?.result?.used === 3,
    String(r.body.data?.result?.used));

  r = await call(session, "GET", "/api/dashboard/applications");
  check("a downgrade DELETES nothing (all 3 still present)",
    r.body.data.applications.length === 3, `got ${r.body.data.applications.length}`);

  r = await call(session, "POST", "/api/dashboard/applications", { name: "App Four" });
  check("while over-limit, creating is still refused", r.status === 403, `got ${r.status}`);

  // ── Deleting an application frees a slot again ────────────────────────
  // Re-fetch: the previous response was a 403 error envelope, not a list.
  r = await call(session, "GET", "/api/dashboard/applications");
  check("still 3 applications while over-limit", r.body.data.applications.length === 3,
    `got ${r.body.data?.applications?.length}`);
  const doomed = r.body.data.applications[0];

  const del = await call(session, "DELETE", `/api/dashboard/applications/${doomed.id}`);
  check("the customer can still delete an application while over-limit",
    del.status === 200, `got ${del.status}`);

  r = await call(session, "POST", "/api/dashboard/applications", { name: "App Four" });
  // 2 used of 2 allowed is exactly AT the cap, so there is still no seat.
  // The account must get back UNDER the limit, not merely down to it.
  check("being exactly at the cap still blocks creation", r.status === 403, `got ${r.status}`);

  // Delete one more: now 1 of 2, so a new application fits.
  r = await call(session, "GET", "/api/dashboard/applications");
  const secondDoomed = r.body.data.applications[0];
  r = await call(session, "DELETE", `/api/dashboard/applications/${secondDoomed.id}`);
  check("a second delete is allowed", r.status === 200, `got ${r.status}`);

  r = await call(session, "POST", "/api/dashboard/applications", { name: "App Four" });
  check("deleting back under the cap frees a slot on the free plan",
    r.status === 201, `got ${r.status}`);

  // ── Authorisation: only an operator may change a plan ─────────────────
  r = await call(session, "PATCH", `/api/admin/customers/${customerId}/plan`, {
    plan: "unlimited",
  });
  check("a customer session cannot reach the plan API", r.status === 401,
    `got ${r.status}`);

  const notAdmin = new Session();
  r = await call(notAdmin, "PATCH", `/api/admin/customers/${customerId}/plan`, {
    plan: "unlimited",
  });
  check("an anonymous caller cannot reach the plan API", r.status === 401, `got ${r.status}`);

  // ── Input validation ──────────────────────────────────────────────────
  r = await call(admin, "PATCH", `/api/admin/customers/${customerId}/plan`, {
    plan: "platinum",
  });
  check("an unknown plan is rejected with 400", r.status === 400, `got ${r.status}`);

  r = await call(admin, "PATCH", "/api/admin/customers/000000000000000000000000/plan", {
    plan: "pro",
  });
  check("a non-existent customer is 404", r.status === 404, `got ${r.status}`);

  // ── The dashboard surfaces the plan ───────────────────────────────────
  const page = await (await fetch("http://127.0.0.1:4311/dashboard/applications", {
    headers: { Cookie: session.header() },
  })).text();
  const text = page
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ");
  check("the applications page shows the subscription plan", text.includes("Free"),
    "plan label missing");
  check("the applications page shows application usage", text.includes("applications"),
    "usage missing");

  // The admin customers list is a server-rendered page (there is no list API
  // by design), so assert the plan actually reaches the operator's UI.
  const customersPage = await fetch("http://127.0.0.1:4311/admin/customers?search=plans", {
    headers: { Cookie: admin.header() },
  });
  const adminHtml = await customersPage.text();
  const adminText = adminHtml
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ");

  check("the admin customers page renders", customersPage.status === 200,
    `got ${customersPage.status}`);
  check("the admin page shows the customer", adminText.includes("plans@example.com"),
    "customer email missing from the operator view");
  check("the admin page shows a plan selector", adminText.includes("Free"),
    "plan label missing");
  check("the admin page offers every tier",
    ["Starter", "Pro", "Unlimited"].every((tier) => adminText.includes(tier)),
    "a plan tier is missing from the selector");
}
