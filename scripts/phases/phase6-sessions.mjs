import { check, section, call } from "../harness.mjs";

/**
 * Phase 6 — bearer sessions, validation, logout, revocation.
 *
 * Every /api/v1 call carries the application id in the `X-App-Id` header.
 */
export async function phase6Sessions(ctx) {
  section("Phase 6 — sessions, validate, logout, revocation");
  const { owner, app, player, token1 } = ctx;
  const AS_APP = { "X-App-Id": app.appId };
  const validate = (token, query = "") =>
    call(null, "GET", `/api/v1/auth/validate${query}`, undefined, {
      ...AS_APP,
      Authorization: `Bearer ${token}`,
    });

  // The phase-4 token was killed by the ban (which revoked sessions). That is
  // exactly the intended behaviour, so assert it before minting a fresh one.
  let r = await validate(token1);
  check("a session revoked by a ban can no longer validate", r.status === 401, `got ${r.status}`);

  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "Player123", deviceId: "device-aaa",
  }, AS_APP);
  check("fresh login issues a new session", r.status === 200, JSON.stringify(r.body).slice(0, 150));
  const live = r.body.data?.sessionToken;

  r = await validate(live);
  check("validate accepts a live token",
    r.status === 200 && r.body.data.valid === true, JSON.stringify(r.body));

  r = await call(null, "GET", "/api/v1/auth/validate");
  check("validate without a token is 401", r.status === 401, `got ${r.status}`);

  r = await call(null, "GET", "/api/v1/auth/validate", undefined, {
    ...AS_APP,
    Authorization: "Bearer forged-token-value-123",
  });
  check("validate with a forged token is 401", r.status === 401, `got ${r.status}`);

  r = await call(null, "GET", "/api/v1/auth/me", undefined, {
    ...AS_APP,
    Authorization: `Bearer ${live}`,
  });
  check("me returns the session identity",
    r.status === 200 && r.body.data.username === "player123", JSON.stringify(r.body));

  r = await validate(live, "?deviceId=device-zzz");
  check("device pinning rejects a mismatched device",
    r.status === 403 && r.body.error === "DEVICE_MISMATCH", JSON.stringify(r.body));

  r = await validate(live, "?deviceId=device-aaa");
  check("device pinning accepts the matching device", r.status === 200, JSON.stringify(r.body));

  r = await call(owner, "POST",
    `/api/dashboard/applications/${app.id}/users/${player.id}/revoke-sessions`, {});
  check("owner can revoke all sessions", r.status === 200, JSON.stringify(r.body).slice(0, 150));

  r = await validate(live);
  check("the revoked token is rejected with SESSION_REVOKED",
    r.status === 401 && r.body.error === "SESSION_REVOKED", JSON.stringify(r.body));

  r = await call(owner, "POST",
    `/api/dashboard/applications/${app.id}/users/${player.id}/reset-devices`, {});
  check("owner can reset devices", r.status === 200, JSON.stringify(r.body).slice(0, 150));

  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "Player123", deviceId: "device-ccc",
  }, AS_APP);
  check("after a reset a previously blocked device can register", r.status === 200,
    JSON.stringify(r.body).slice(0, 150));
  const fresh = r.body.data?.sessionToken;

  r = await call(null, "POST", "/api/v1/auth/logout", {}, {
    ...AS_APP,
    Authorization: `Bearer ${fresh}`,
  });
  check("logout succeeds", r.status === 200, JSON.stringify(r.body));

  r = await validate(fresh);
  check("the token is dead after logout", r.status === 401, `got ${r.status}`);

  // ─────────────────────────────────────────────────────────────────────────
  // Owner Stop / Start. The promise is "no authentication is accepted while
  // stopped" — which has to mean BOTH new logins AND sessions that are already
  // live. Gating only login would look like it worked while every signed-in
  // user sailed straight through.
  // ─────────────────────────────────────────────────────────────────────────
  section("Phase 6 — stop and start the application");

  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "Player123", deviceId: "device-aaa",
  }, AS_APP);
  check("a token is minted before the app is stopped", r.status === 200,
    JSON.stringify(r.body).slice(0, 140));
  const beforeStop = r.body.data?.sessionToken;
  r = await validate(beforeStop);
  check("that token works while the app is running", r.status === 200, `got ${r.status}`);

  r = await call(owner, "PATCH", `/api/dashboard/applications/${app.id}/status`, {
    status: "suspended",
  });
  check("the owner can stop the application", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
  check("the response reports the new status",
    r.body.data?.application?.status === "suspended",
    JSON.stringify(r.body.data?.application?.status));

  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "Player123", deviceId: "device-aaa",
  }, AS_APP);
  check("login is refused while the app is stopped", r.status === 503, `got ${r.status}`);
  check("the refusal is reported as APP_SUSPENDED", r.body?.error === "APP_SUSPENDED",
    JSON.stringify(r.body));

  // THE assertion: a session that was valid a moment ago must die too.
  r = await validate(beforeStop);
  check("an ALREADY-ISSUED session is refused while stopped", r.status === 503,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  check("the live session reports APP_SUSPENDED, not a session error",
    r.body?.error === "APP_SUSPENDED", JSON.stringify(r.body));

  r = await call(null, "GET", "/api/v1/auth/me", undefined, {
    ...AS_APP, Authorization: `Bearer ${beforeStop}`,
  });
  check("/auth/me is refused too while stopped", r.status === 503, `got ${r.status}`);

  // 503, never 401: a client that reads 401 as "bad token" will delete a
  // perfectly good session and lock its own user out of the product.
  check("a stopped app is never reported as an auth failure",
    r.status !== 401 && r.status !== 403, `got ${r.status}`);

  // The dashboard must stay reachable, or the owner could never press Start.
  r = await call(owner, "GET", `/api/dashboard/applications/${app.id}/users?limit=1`);
  check("the dashboard still works while the app is stopped", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

  // Another tenant's application must be out of reach. `intruder` is a real
  // second customer (ctx.app2 is a second app of the SAME owner, so it would
  // have passed and proved nothing).
  r = await call(ctx.intruder, "PATCH", `/api/dashboard/applications/${app.id}/status`, {
    status: "suspended",
  });
  check("another customer cannot stop this application", r.status === 404,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);

  r = await call(owner, "PATCH", `/api/dashboard/applications/${app.id}/status`, {
    status: "nonsense",
  });
  check("an unknown status is rejected", r.status === 400, `got ${r.status}`);

  // ── Start again ───────────────────────────────────────────────────────────
  r = await call(owner, "PATCH", `/api/dashboard/applications/${app.id}/status`, {
    status: "active",
  });
  check("the owner can start the application again", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);

  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "Player123", deviceId: "device-aaa",
  }, AS_APP);
  check("login works again after starting", r.status === 200,
    JSON.stringify(r.body).slice(0, 140));

  // Stopping must be reversible WITHOUT forcing a re-login: nothing is deleted.
  r = await validate(beforeStop);
  check("the session issued before the stop still works after starting",
    r.status === 200, `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

  // ─────────────────────────────────────────────────────────────────────────
  // Session renewal. There was no way to extend a session at all, so every end
  // user had to re-enter their password when the 30-day window closed.
  // ─────────────────────────────────────────────────────────────────────────
  section("Phase 6 — session renewal");

  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "Player123", deviceId: "device-aaa",
  }, AS_APP);
  check("a session is minted for the renewal test", r.status === 200,
    JSON.stringify(r.body).slice(0, 140));
  const renewable = r.body.data?.sessionToken;
  const firstExpiry = r.body.data?.expiresAt;
  check("login reports an expiry the client can plan around", Boolean(firstExpiry),
    JSON.stringify(r.body.data?.expiresAt));

  r = await call(null, "POST", "/api/v1/auth/refresh", {}, {
    ...AS_APP, Authorization: `Bearer ${renewable}`,
  });
  check("a live session can be renewed", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
  check("renewal returns a new expiry", Boolean(r.body.data?.expiresAt),
    JSON.stringify(r.body.data));
  check("renewal never shortens the session",
    new Date(r.body.data?.expiresAt ?? 0).getTime() >= new Date(firstExpiry ?? 0).getTime(),
    `was ${firstExpiry} now ${r.body.data?.expiresAt}`);

  r = await call(null, "GET", "/api/v1/auth/validate", undefined, {
    ...AS_APP, Authorization: `Bearer ${renewable}`,
  });
  check("the token still works after renewal (it is not rotated)", r.status === 200,
    `got ${r.status}`);

  r = await call(null, "POST", "/api/v1/auth/refresh", {}, { ...AS_APP });
  check("refresh without a token is 401", r.status === 401, `got ${r.status}`);
  r = await call(null, "POST", "/api/v1/auth/refresh", {}, {
    ...AS_APP, Authorization: "Bearer not-a-real-token",
  });
  check("refresh with a bogus token is 401", r.status === 401, `got ${r.status}`);

  // ─────────────────────────────────────────────────────────────────────────
  // End-user self-service. Previously an end user could neither change their
  // own password nor see/revoke their own sessions — both were owner-only,
  // dashboard-only features. A customer with an unresponsive owner had no way
  // to respond to a compromise.
  // ─────────────────────────────────────────────────────────────────────────
  section("Phase 6 — end-user self-service");

  r = await call(null, "GET", "/api/v1/auth/sessions", undefined, {
    ...AS_APP, Authorization: `Bearer ${renewable}`,
  });
  check("an end user can list their own sessions", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
  check("the listing identifies the current session", Boolean(r.body.data?.currentSessionId),
    JSON.stringify(r.body.data));
  check("session entries are returned", (r.body.data?.sessions ?? []).length > 0,
    JSON.stringify(r.body.data?.sessions));

  // A second SESSION on an EXISTING device, so revoke-others has something to
  // revoke. Reuses device-aaa deliberately: a fresh deviceId would be refused
  // by the seat limit (2/2) and this test is about sessions, not devices.
  const other = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "Player123", deviceId: "device-aaa",
  }, AS_APP);
  check("a second session exists for the revoke test", other.status === 200,
    `got ${other.status} ${JSON.stringify(other.body).slice(0, 120)}`);
  const otherToken = other.body.data?.sessionToken;

  r = await call(null, "POST", "/api/v1/auth/sessions/revoke-others", {}, {
    ...AS_APP, Authorization: `Bearer ${renewable}`,
  });
  check("an end user can revoke their other sessions", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
  check("other sessions were actually revoked", r.body.data?.revoked > 0,
    `revoked ${r.body.data?.revoked}`);

  r = await call(null, "GET", "/api/v1/auth/validate", undefined, {
    ...AS_APP, Authorization: `Bearer ${otherToken}`,
  });
  check("the OTHER session is dead after revoke-others", r.status === 401,
    `got ${r.status}`);

  r = await call(null, "GET", "/api/v1/auth/validate", undefined, {
    ...AS_APP, Authorization: `Bearer ${renewable}`,
  });
  check("the caller's own session survives revoke-others", r.status === 200,
    `got ${r.status}`);

  // ── self-service password change ─────────────────────────────────────────
  r = await call(null, "POST", "/api/v1/auth/password", {
    currentPassword: "Player123", newPassword: "NewPlayer456",
  }, { ...AS_APP, Authorization: `Bearer ${renewable}` });
  check("an end user can change their own password", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);

  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "NewPlayer456", deviceId: "device-aaa",
  }, AS_APP);
  check("the NEW password authenticates", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);

  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "Player123", deviceId: "device-aaa",
  }, AS_APP);
  check("the OLD password no longer authenticates", r.status === 401,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);

  // The step-up check: a valid session alone is not enough. Without it, a
  // stolen session could take the account over permanently.
  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "NewPlayer456", deviceId: "device-aaa",
  }, AS_APP);
  const stepUp = r.body.data?.sessionToken;
  r = await call(null, "POST", "/api/v1/auth/password", {
    currentPassword: "Player123", newPassword: "Hijack12345",
  }, { ...AS_APP, Authorization: `Bearer ${stepUp}` });
  check("changing the password needs the CURRENT password, not just a session",
    r.status === 401 && r.body.error === "CURRENT_PASSWORD_INCORRECT",
    `got ${r.status} ${r.body?.error}`);

  r = await call(null, "POST", "/api/v1/auth/password", {
    currentPassword: "NewPlayer456", newPassword: "NewPlayer456",
  }, { ...AS_APP, Authorization: `Bearer ${stepUp}` });
  check("re-using the same password is refused as a no-op", r.status === 400,
    `got ${r.status} ${r.body?.error}`);

  // End-user passwords are deliberately UNCONSTRAINED (see phase 20): a
  // one-character or lowercase password is legitimate, because the customer's
  // product decides the format. The rule that still holds is bcrypt's 72-byte
  // ceiling, because beyond it two different passwords would authenticate the
  // same.
  r = await call(null, "POST", "/api/v1/auth/password", {
    currentPassword: "NewPlayer456", newPassword: "weak",
  }, { ...AS_APP, Authorization: `Bearer ${stepUp}` });
  check("a weak end-user password is ACCEPTED (the realm imposes no policy)",
    r.status === 200, `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);

  r = await call(null, "POST", "/api/v1/auth/password", {
    currentPassword: "weak", newPassword: "a".repeat(73),
  }, { ...AS_APP, Authorization: `Bearer ${stepUp}` });
  check("a password past bcrypt's 72-byte limit is still refused",
    r.status === 400, `got ${r.status}`);

  // Put the fixture password back for the phases that follow.
  r = await call(owner, "PATCH", `/api/dashboard/applications/${app.id}/users/${player.id}`, {
    password: "Player123",
  });
  check("the original password is restored", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);

  // ── health probe ─────────────────────────────────────────────────────────
  r = await call(null, "GET", "/api/health");
  check("the health endpoint responds without credentials", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
  check("the health endpoint reports the database as up",
    r.body.data?.checks?.database === "up", JSON.stringify(r.body.data));
  check("the health endpoint leaks no internal detail",
    !JSON.stringify(r.body).toLowerCase().includes("mongodb://"),
    JSON.stringify(r.body));
}
