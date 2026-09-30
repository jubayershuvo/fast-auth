import { check, section, call, registerAndVerify, Session } from "../harness.mjs";

/** Phase 2 — applications, ownership enforcement, secret handling. */
export async function phase2Applications(ctx) {
  section("Phase 2 — applications, ownership, secret handling");
  const { owner } = ctx;

  let r = await call(owner, "POST", "/api/dashboard/applications", {
    name: "MyGame", description: "Test game",
  });
  check("create application returns 201", r.status === 201, `got ${r.status}`);
  ctx.app = r.body.data;
  const app = ctx.app;
  check("appId uses the fa_ prefix", /^fa_/.test(app?.appId ?? ""), String(app?.appId));
  check("appSecret is returned on create",
    typeof app?.appSecret === "string" && app.appSecret.length > 20);
  check("appSecretHash is never exposed",
    !JSON.stringify(r.body).includes("appSecretHash"));

  r = await call(owner, "GET", "/api/dashboard/applications");
  check("list returns the new application",
    r.status === 200 && r.body.data.applications.length === 1,
    JSON.stringify(r.body).slice(0, 150));
  check("list never re-exposes the secret",
    !JSON.stringify(r.body).includes(app.appSecret));

  r = await call(owner, "GET", `/api/dashboard/applications/${app.id}`);
  check("get single application works", r.status === 200, `got ${r.status}`);

  r = await call(owner, "PATCH", `/api/dashboard/applications/${app.id}`, { name: "MyGame v2" });
  check("rename works", r.status === 200 && r.body.data.application.name === "MyGame v2",
    JSON.stringify(r.body).slice(0, 150));

  r = await call(owner, "PATCH", `/api/dashboard/applications/${app.id}`, { description: "Updated" });
  check("description update works", r.status === 200, `got ${r.status}`);

  // Second customer — must be completely isolated.
  const intruder = new Session();
  ctx.intruder = intruder;
  r = await registerAndVerify(intruder, {
    name: "Ivan Intruder",
    name: "Ivan Intruder", email: "intruder@example.com", username: "intruder", password: "Intruder1",
  });
  // 200 (not 201): `registerAndVerify` finishes on the VERIFY call, which
  // returns 200. The register half is asserted in phase 1.
  check("second customer registers and verifies", r.status === 200, `got ${r.status}`);

  r = await call(intruder, "GET", `/api/dashboard/applications/${app.id}`);
  check("IDOR: other customer cannot read the application (404)", r.status === 404, `got ${r.status}`);

  r = await call(intruder, "DELETE", `/api/dashboard/applications/${app.id}`);
  check("IDOR: other customer cannot delete the application (404)", r.status === 404, `got ${r.status}`);

  r = await call(intruder, "GET", "/api/dashboard/applications");
  check("other customer sees zero applications",
    r.status === 200 && r.body.data.applications.length === 0, JSON.stringify(r.body).slice(0, 120));

  // A second application owned by the first customer.
  r = await call(owner, "POST", "/api/dashboard/applications", { name: "MySoftware" });
  check("second application created", r.status === 201, `got ${r.status}`);
  ctx.app2 = r.body.data;
}
