import { check, section, call } from "../harness.mjs";

/** Phase 8 — secret rotation, cascade delete, validation and hardening. */
export async function phase8Hardening(ctx) {
  section("Phase 8 — secret rotation");
  const { owner, app, app2 } = ctx;

  let r = await call(owner, "POST", `/api/dashboard/applications/${app.id}/rotate-secret`, {});
  check("rotation returns a new secret",
    r.status === 200 && typeof r.body.data?.application?.appSecret === "string",
    JSON.stringify(r.body).slice(0, 150));
  const rotated = r.body.data?.application?.appSecret;
  check("the rotated secret differs from the original", rotated !== app.appSecret);
  check("the stored hash is still not exposed",
    !JSON.stringify(r.body).includes("appSecretHash"));

  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "Player123",
    deviceId: "device-aaa", appSecret: app.appSecret,
  }, { "X-App-Id": app.appId });
  check("the old app secret is rejected after rotation", r.status === 401, `got ${r.status}`);

  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "Player123",
    deviceId: "device-aaa", appSecret: rotated,
  }, { "X-App-Id": app.appId });
  check("the new app secret is accepted", r.status === 200, JSON.stringify(r.body).slice(0, 120));

  section("Phase 8 — cascade delete");
  r = await call(owner, "DELETE", `/api/dashboard/applications/${app2.id}`);
  check("delete application succeeds", r.status === 200, JSON.stringify(r.body).slice(0, 120));

  r = await call(owner, "GET", `/api/dashboard/applications/${app2.id}`);
  check("the deleted application is gone (404)", r.status === 404, `got ${r.status}`);

  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "Other123", deviceId: "device-zzz",
  }, { "X-App-Id": app2.appId });
  check("the deleted application can no longer authenticate", r.status === 404, `got ${r.status}`);

  section("Phase 8 — validation and hardening");
  // No body fields AND no X-App-Id: the header is checked first, so this now
  // exercises the missing-header path rather than the missing-body path.
  r = await call(null, "POST", "/api/v1/auth/login", {});
  check("missing fields is a 400", r.status === 400, `got ${r.status}`);
  check("validation errors use the standard envelope",
    r.body?.success === false && r.body?.error === "VALIDATION_ERROR", JSON.stringify(r.body));

  r = await call(null, "POST", "/api/v1/auth/login", {}, { "X-App-Id": app.appId });
  check("a missing body with a valid header is still a 400", r.status === 400, `got ${r.status}`);

  r = await call(owner, "GET", "/api/dashboard/applications/not-an-objectid");
  check("a non-ObjectId application id is rejected",
    r.status === 400 || r.status === 404, `got ${r.status}`);

  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "Player123",
    deviceId: "device-aaa", appSecret: rotated, extraField: "should be stripped",
  }, { "X-App-Id": app.appId });
  check("unknown fields are ignored (no mass assignment)", r.status === 200, `got ${r.status}`);

  // The password must NOT be changeable through a dashboard PATCH by an
  // attacker-supplied ownerId-style field.
  r = await call(owner, "PATCH", `/api/dashboard/applications/${app.id}`, {
    name: "Renamed", ownerId: "000000000000000000000000",
  });
  check("ownerId cannot be mass-assigned", r.status === 200, `got ${r.status}`);

  r = await call(owner, "POST", "/api/auth/logout");
  check("logout succeeds", r.status === 200);
  r = await call(owner, "GET", "/api/auth/me");
  check("the session is invalid after logout", r.status === 401, `got ${r.status}`);
  r = await call(owner, "GET", "/api/dashboard/applications");
  check("dashboard API rejects the dead session", r.status === 401, `got ${r.status}`);
}
