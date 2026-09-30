import { check, section, call } from "../harness.mjs";

/**
 * Phase 4 — the public /api/v1 authentication endpoints.
 *
 * The application id travels in the `X-App-Id` header, so every call here
 * passes it via `extraHeaders` and leaves it out of the body.
 */
export async function phase4Login(ctx) {
  section("Phase 4 — public v1 login API");
  // `player` is deliberately NOT destructured: the deviceName probes use a
  // throwaway user so they cannot consume the shared fixture's seats.
  const { owner, app, app2 } = ctx;
  const asApp = (appId) => ({ "X-App-Id": appId });

  let r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "Player123", deviceId: "device-aaa",
  }, asApp(app.appId));
  check("v1 login succeeds", r.status === 200, JSON.stringify(r.body).slice(0, 200));
  ctx.token1 = r.body.data?.sessionToken;
  check("v1 login returns a session token",
    typeof ctx.token1 === "string" && ctx.token1.length > 20);
  check("v1 login reports device 1 of 2",
    r.body.data?.user?.devicesUsed === 1 && r.body.data?.user?.maxDevices === 2,
    JSON.stringify(r.body.data?.user));
  check("v1 login never returns the password hash",
    !JSON.stringify(r.body).includes("passwordHash"));

  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "WrongPass1", deviceId: "device-aaa",
  }, asApp(app.appId));
  check("wrong password is 401 INVALID_CREDENTIALS",
    r.status === 401 && r.body.error === "INVALID_CREDENTIALS", JSON.stringify(r.body));

  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "Player123", deviceId: "short",
  }, asApp(app.appId));
  check("too-short deviceId is a 400", r.status === 400, `got ${r.status}`);

  // ── The X-App-Id header is the only accepted location ──────────────────
  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "Player123", deviceId: "device-aaa",
  });
  check("a missing X-App-Id header is 400", r.status === 400, `got ${r.status}`);
  check("the missing-header error names the header",
    String(r.body?.message ?? "").includes("X-App-Id"),
    JSON.stringify(r.body));
  check("the missing-header error points at the old body field",
    String(r.body?.message ?? "").toLowerCase().includes("body"),
    "the message should tell legacy callers what changed");

  // A body appId alone must NOT authenticate: otherwise the break is silent
  // and a half-migrated client keeps working against the wrong application.
  r = await call(null, "POST", "/api/v1/auth/login", {
    appId: app.appId, username: "player123", password: "Player123",
    deviceId: "device-aaa",
  });
  check("an appId in the body no longer authenticates", r.status === 400,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

  // Well-formed but non-existent appId: must 404, not 400 (the shape is valid).
  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "Player123", deviceId: "device-aaa",
  }, asApp(`fa_${"a".repeat(16)}`));
  check("unknown appId is 404 INVALID_APPLICATION",
    r.status === 404 && r.body.error === "INVALID_APPLICATION", JSON.stringify(r.body));

  // Malformed appId must be rejected by validation before any DB access.
  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "Player123", deviceId: "device-aaa",
  }, asApp("not-even-close"));
  check("malformed appId is a 400 from validation", r.status === 400, `got ${r.status}`);

  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "ghostuser", password: "Whatever1", deviceId: "device-aaa",
  }, asApp(app.appId));
  check("unknown user is 401 INVALID_CREDENTIALS",
    r.status === 401 && r.body.error === "INVALID_CREDENTIALS", JSON.stringify(r.body));

  // THE core isolation test: right username, right password-shape, wrong app.
  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "Player123", deviceId: "device-aaa",
  }, asApp(app2.appId));
  check("tenant isolation: app2's password is rejected under app1",
    r.status === 401, `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "Other123", deviceId: "device-zzz",
  }, asApp(app2.appId));
  check("the same username works with its own app's password", r.status === 200,
    JSON.stringify(r.body).slice(0, 150));

  // ─────────────────────────────────────────────────────────────────────────
  // deviceName at login. Optional, and it only ever applies the FIRST time a
  // device is seen — otherwise a returning client could silently rename a
  // device or wipe a label the owner typed in the dashboard.
  // ─────────────────────────────────────────────────────────────────────────
  section("Phase 4 — device name from login");

  /*
   * A THROWAWAY user, deliberately.
   *
   * The shared fixture user (player123) has maxDevices: 2, and resetting that
   * user revokes the session later phases authenticate with. Probing on them
   * therefore breaks Phase 5 for reasons unrelated to Phase 5. This user is
   * deleted at the end, leaving the shared state untouched.
   */
  r = await call(owner, "POST", `/api/dashboard/applications/${app.id}/users`, {
    name: "Nina Named", username: "namedprobe", password: "NamedProbe1", maxDevices: 10,
  });
  check("a throwaway user is created for the deviceName probes", r.status === 201,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
  const probeUser = r.body.data;
  if (!probeUser?.id) return;

  const probeLogin = (deviceId, deviceName) =>
    call(null, "POST", "/api/v1/auth/login", {
      username: "namedprobe", password: "NamedProbe1", deviceId, deviceName,
    }, asApp(app.appId));

  const devicesFor = async (deviceId) => {
    const res = await call(owner, "GET",
      `/api/dashboard/applications/${app.id}/devices?limit=100`);
    return (res.body.data?.devices ?? []).find((d) => d.deviceId === deviceId);
  };

  r = await probeLogin("named-device-01", "Ada's Laptop");
  check("login accepts an optional deviceName", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);

  let row = await devicesFor("named-device-01");
  check("the supplied deviceName is stored on first registration",
    row?.deviceName === "Ada's Laptop", JSON.stringify(row?.deviceName));

  // A returning login must NOT overwrite the label.
  r = await probeLogin("named-device-01", "HACKED");
  check("a returning login still succeeds", r.status === 200, `got ${r.status}`);

  row = await devicesFor("named-device-01");
  check("a returning login cannot rename the device", row?.deviceName === "Ada's Laptop",
    JSON.stringify(row?.deviceName));

  // An empty name means "not supplied", not an error — and must not persist
  // as "", which renders as a blank cell instead of "Unnamed device".
  r = await probeLogin("blank-name-device", "");
  check("an empty deviceName does not fail the login", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);

  row = await devicesFor("blank-name-device");
  check("an empty deviceName persists as null, not an empty string",
    row?.deviceName === null, JSON.stringify(row?.deviceName));

  // The limit must be identical everywhere. It used to be 120 at login and 80
  // in the dashboard, so a client could store a name the owner could not then
  // edit without shortening it first.
  r = await probeLogin("long-name-device", "n".repeat(81));
  check("a deviceName over 80 characters is rejected at login", r.status === 400,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

  r = await probeLogin("long-name-device", "n".repeat(80));
  check("a deviceName of exactly 80 characters is accepted", r.status === 200,
    `got ${r.status}`);

  r = await probeLogin("no-name-device", undefined);
  check("deviceName remains genuinely optional", r.status === 200, `got ${r.status}`);

  // Remove the throwaway user so nothing leaks into later phases.
  r = await call(owner, "DELETE",
    `/api/dashboard/applications/${app.id}/users/${probeUser.id}`);
  check("the throwaway user is removed", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
}
