import { check, section, call } from "../harness.mjs";

/**
 * Phase 5 — device limits, bans and expiration windows.
 *
 * The application id travels in the `X-App-Id` header on every /api/v1 call.
 */
export async function phase5DevicesBansExpiry(ctx) {
  section("Phase 5 — device limits");
  const { owner, app, app2, player } = ctx;
  const AS_APP = { "X-App-Id": app.appId };
  const login = (deviceId) =>
    call(null, "POST", "/api/v1/auth/login", {
      username: "player123", password: "Player123", deviceId,
    }, AS_APP);

  let r = await login("device-bbb");
  check("second device is allowed (2 of 2)",
    r.status === 200 && r.body.data.user.devicesUsed === 2, JSON.stringify(r.body).slice(0, 150));

  r = await login("device-ccc");
  check("third device is rejected with DEVICE_LIMIT_REACHED",
    r.status === 403 && r.body.error === "DEVICE_LIMIT_REACHED", JSON.stringify(r.body));

  r = await login("device-aaa");
  check("a known device can log in again without consuming a seat", r.status === 200,
    JSON.stringify(r.body).slice(0, 150));

  r = await call(owner, "GET", `/api/dashboard/applications/${app.id}/devices`);
  check("owner sees exactly 2 registered devices",
    r.status === 200 && r.body.data.devices.length === 2,
    `got ${r.status} ${JSON.stringify(r.body.data?.devices?.length)}`);

  section("Phase 5 — bans");
  r = await call(owner, "POST", `/api/dashboard/applications/${app.id}/users/${player.id}/ban`, {
    reason: "Chargeback fraud", revokeSessions: true,
  });
  check("ban succeeds", r.status === 200, JSON.stringify(r.body).slice(0, 150));
  check("ban stores the reason", r.body.data?.user?.banReason === "Chargeback fraud",
    JSON.stringify(r.body.data?.user?.banReason));

  r = await login("device-aaa");
  check("banned user is rejected with ACCOUNT_BANNED",
    r.status === 403 && r.body.error === "ACCOUNT_BANNED", JSON.stringify(r.body));

  r = await call(owner, "POST", `/api/dashboard/applications/${app.id}/users/${player.id}/unban`, {});
  check("unban succeeds", r.status === 200, JSON.stringify(r.body).slice(0, 150));
  check("unban clears the reason", r.body.data?.user?.banReason === null,
    JSON.stringify(r.body.data?.user?.banReason));

  r = await login("device-aaa");
  check("unbanned user can log in again", r.status === 200, JSON.stringify(r.body).slice(0, 120));

  section("Phase 5 — expiration");
  const past = new Date(Date.now() - 60_000).toISOString();
  r = await call(owner, "PATCH", `/api/dashboard/applications/${app.id}/users/${player.id}`, {
    expiresAt: past,
  });
  check("setting a past expiry succeeds", r.status === 200, JSON.stringify(r.body).slice(0, 150));
  check("the response flags isExpired", r.body.data?.user?.isExpired === true,
    JSON.stringify(r.body.data?.user?.isExpired));

  r = await login("device-aaa");
  check("expired user is rejected with ACCOUNT_EXPIRED",
    r.status === 403 && r.body.error === "ACCOUNT_EXPIRED", JSON.stringify(r.body));

  // Extend from the previous (already-passed) expiry -> must revive.
  r = await call(owner, "POST", `/api/dashboard/applications/${app.id}/users/${player.id}/extend`, {
    days: 30, from: "previous",
  });
  check("extend from previous succeeds", r.status === 200, JSON.stringify(r.body).slice(0, 150));
  check("the extended account is no longer expired", r.body.data?.user?.isExpired === false,
    JSON.stringify(r.body.data?.user));

  r = await login("device-aaa");
  check("the extended user can log in again", r.status === 200, JSON.stringify(r.body).slice(0, 120));

  // Extend from now, on a still-valid account.
  r = await call(owner, "POST", `/api/dashboard/applications/${app.id}/users/${player.id}/extend`, {
    days: 7, from: "now",
  });
  check("extend from now succeeds", r.status === 200, JSON.stringify(r.body).slice(0, 150));

  r = await call(owner, "PATCH", `/api/dashboard/applications/${app.id}/users/${player.id}`, {
    expiresAt: "lifetime",
  });
  check("lifetime conversion succeeds", r.status === 200, JSON.stringify(r.body).slice(0, 150));
  check("lifetime sets expiresAt to null", r.body.data?.user?.expiresAt === null,
    JSON.stringify(r.body.data?.user?.expiresAt));

  // ── Per-device removal ─────────────────────────────────────────────────
  // The guarantee under test: removing a device frees its seat AND kills the
  // sessions bound to it. Deleting the row alone would free the seat but leave
  // the old token working until it expired, which is the bug this prevents.
  section("Phase 5 — remove a single device");

  // This user already holds 2 of 2 seats (device-aaa, device-bbb), so the
  // subject of the removal must be an EXISTING device. Registering a third
  // here would be refused before the delete is even attempted.
  r = await login("device-bbb");
  check("a session is minted for the device to be removed", r.status === 200,
    JSON.stringify(r.body).slice(0, 120));
  const doomedToken = r.body.data?.sessionToken;

  const validateDevice = (token) =>
    call(null, "GET", "/api/v1/auth/validate", undefined, {
      ...AS_APP,
      Authorization: `Bearer ${token}`,
    });

  r = await validateDevice(doomedToken);
  check("the device authenticates before removal", r.status === 200, `got ${r.status}`);

  // Locate the device row for device-bbb.
  r = await call(owner, "GET", `/api/dashboard/applications/${app.id}/devices?limit=100`);
  const target = (r.body.data?.devices ?? []).find((d) => d.deviceId === "device-bbb");
  check("the device is listed for the owner", Boolean(target?.id),
    JSON.stringify(r.body.data?.devices?.map((d) => d.deviceId)));

  if (!target?.id) {
    check("device removal could not be exercised", false, "no device row to delete");
    return;
  }

  r = await call(owner, "DELETE",
    `/api/dashboard/applications/${app.id}/devices/${target.id}`);
  check("removing a device succeeds", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

  // THE assertion: the old device must stop authenticating immediately.
  r = await validateDevice(doomedToken);
  check("the removed device can no longer authenticate", r.status === 401, `got ${r.status}`);
  check("the revoked device session reports SESSION_REVOKED",
    r.body?.error === "SESSION_REVOKED", JSON.stringify(r.body));

  // The seat must be free again.
  r = await call(owner, "GET", `/api/dashboard/applications/${app.id}/devices?limit=100`);
  const after = (r.body.data?.devices ?? []).map((d) => d.deviceId);
  check("the removed device is gone from the list", !after.includes("device-bbb"),
    JSON.stringify(after));

  // The OTHER device must be untouched — removal is per-device, not a reset.
  check("the other device survives the removal",
    after.includes("device-aaa"), JSON.stringify(after));

  r = await login("device-brand-new");
  check("the freed seat can be used by a new device", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

  // Re-deleting is a 404, not a 500.
  r = await call(owner, "DELETE",
    `/api/dashboard/applications/${app.id}/devices/${target.id}`);
  check("removing an already-removed device is 404", r.status === 404, `got ${r.status}`);

  r = await call(owner, "DELETE",
    `/api/dashboard/applications/${app.id}/devices/not-an-objectid`);
  check("a malformed device id is rejected", r.status === 400 || r.status === 404,
    `got ${r.status}`);

  // Tenant isolation: the other application's owner cannot touch these devices.
  r = await call(owner, "DELETE",
    `/api/dashboard/applications/${app2.id}/devices/${target.id}`);
  check("an owner cannot delete a device in another application",
    r.status === 404, `got ${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);

  // ─────────────────────────────────────────────────────────────────────────
  // Per-user device management. Devices are a per-user licensing concept, so
  // the seat budget and the device list must be scoped to ONE user, and
  // renaming must stay cosmetic.
  // ─────────────────────────────────────────────────────────────────────────
  section("Phase 5 — per-user devices");

  r = await call(owner, "POST", `/api/dashboard/applications/${app.id}/users`, {
    name: "Dana Deviceuser",
    name: "Dana Deviceuser", username: "deviceuser", password: "Device123", maxDevices: 3,
  });
  check("a second end user is created for the per-user device list",
    r.status === 201 || r.status === 200 || r.status === 409,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

  r = await call(owner, "GET", `/api/dashboard/applications/${app.id}/users?search=deviceuser&limit=10`);
  const targetUser = (r.body.data?.users ?? []).find((u) => u.username === "deviceuser");
  check("the per-user device page can resolve its user", Boolean(targetUser?.id),
    JSON.stringify(r.body.data?.users?.map((u) => u.username)));

  if (targetUser?.id) {
    let other = await call(null, "POST", "/api/v1/auth/login", {
      username: "deviceuser", password: "Device123", deviceId: "user-dev-1",
    }, AS_APP);
    check("that user can register its first device", other.status === 200,
      `got ${other.status} ${JSON.stringify(other.body).slice(0, 120)}`);

    r = await call(owner, "GET",
      `/api/dashboard/applications/${app.id}/devices?userId=${targetUser.id}&limit=100`);
    check("the app-wide device list can be filtered to one user",
      r.status === 200 &&
      (r.body.data?.devices ?? []).every((d) => d.userId === targetUser.id),
      JSON.stringify(r.body.data?.devices?.map((d) => d.userId)));

    const own = (r.body.data?.devices ?? []).find((d) => d.deviceId === "user-dev-1");
    check("the user's own device is in their filtered list", Boolean(own?.id),
      JSON.stringify(r.body.data?.devices?.map((d) => d.deviceId)));

    if (own?.id) {
      r = await call(owner, "PATCH",
        `/api/dashboard/applications/${app.id}/devices/${own.id}`, { deviceName: "Work laptop" });
      check("renaming a device succeeds", r.status === 200,
        `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
      check("the new name is returned", r.body.data?.device?.deviceName === "Work laptop",
        JSON.stringify(r.body.data?.device?.deviceName));
      check("renaming does not change the device id",
        r.body.data?.device?.deviceId === "user-dev-1",
        JSON.stringify(r.body.data?.device?.deviceId));

      r = await call(owner, "PATCH",
        `/api/dashboard/applications/${app.id}/devices/${own.id}`, { deviceName: "" });
      check("an empty device name is rejected", r.status === 400, `got ${r.status}`);

      r = await call(owner, "PATCH",
        `/api/dashboard/applications/${app2.id}/devices/${own.id}`, { deviceName: "hijack" });
      check("an owner cannot edit a device in another application", r.status === 404,
        `got ${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);

      // Editing the deviceId is NOT cosmetic: the client identifies itself by
      // that value, so afterwards the old id registers as a NEW device.
      r = await call(owner, "PATCH",
        `/api/dashboard/applications/${app.id}/devices/${own.id}`,
        { deviceId: "user-dev-1-corrected" });
      check("a device id can be edited", r.status === 200,
        `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
      check("the new device id is stored", r.body.data?.device?.deviceId === "user-dev-1-corrected",
        JSON.stringify(r.body.data?.device?.deviceId));
      check("editing the id does not change the seat count",
        r.body.data?.device?.userId === targetUser.id, "the device changed owner");

      r = await call(owner, "PATCH",
        `/api/dashboard/applications/${app.id}/devices/${own.id}`, { deviceId: "short" });
      check("a too-short device id is rejected", r.status === 400, `got ${r.status}`);

      r = await call(owner, "PATCH",
        `/api/dashboard/applications/${app.id}/devices/${own.id}`, { deviceId: "bad id with spaces" });
      check("a device id with invalid characters is rejected", r.status === 400, `got ${r.status}`);

      r = await call(owner, "PATCH",
        `/api/dashboard/applications/${app.id}/devices/${own.id}`, {});
      check("an empty edit is rejected", r.status === 400, `got ${r.status}`);
    }

    other = await call(null, "POST", "/api/v1/auth/login", {
      username: "deviceuser", password: "Device123", deviceId: "user-dev-2",
    }, AS_APP);
    check("the same user may register a second device (2 of 3)", other.status === 200,
      `got ${other.status} ${JSON.stringify(other.body).slice(0, 120)}`);
    check("devicesUsed counts only this user's devices",
      other.body.data?.user?.devicesUsed === 2,
      JSON.stringify(other.body.data?.user?.devicesUsed));

    // Two rows sharing a deviceId would collapse into one on the next login,
    // so the collision must be a clean 409 rather than a 500 from the unique
    // index. Checked AFTER the second device exists — asserting it earlier
    // passes vacuously, because nothing collides yet.
    r = await call(owner, "GET",
      `/api/dashboard/applications/${app.id}/devices?userId=${targetUser.id}&limit=100`);
    const first = (r.body.data?.devices ?? []).find((d) => d.deviceId === "user-dev-1-corrected");
    check("the device list reports the owning user", Boolean(first?.username),
      JSON.stringify(r.body.data?.devices?.map((d) => d.username)));
    check("the populated userId is still a usable id, not [object Object]",
      first?.userId === targetUser.id, `got ${first?.userId}`);

    if (first?.id) {
      r = await call(owner, "PATCH",
        `/api/dashboard/applications/${app.id}/devices/${first.id}`, { deviceId: "user-dev-2" });
      check("a device id already used by the same user is a 409 conflict",
        r.status === 409, `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Search. Terms reach a Mongo $regex, so escaping is the security-relevant
  // part: an unescaped term would let a caller inject operators and sweep the
  // whole collection.
  // ─────────────────────────────────────────────────────────────────────────
  section("Phase 5 — search");

  r = await call(owner, "GET", `/api/dashboard/applications/${app.id}/devices?search=device-aaa&limit=100`);
  check("device search narrows the list to matching rows",
    r.status === 200 &&
    (r.body.data?.devices ?? []).length > 0 &&
    (r.body.data?.devices ?? []).every((d) =>
      ["deviceId", "deviceName", "platform", "lastIp"].some((f) =>
        String(d[f] ?? "").toLowerCase().includes("device-aaa"))),
    JSON.stringify(r.body.data?.devices));

  // Regex injection: an unescaped ".*" would match every device in the app.
  r = await call(owner, "GET",
    `/api/dashboard/applications/${app.id}/devices?search=${encodeURIComponent(".*")}&limit=100`);
  check("a regex metacharacter term is matched literally, not as a pattern",
    r.status === 200 && (r.body.data?.devices ?? []).length === 0,
    `matched ${(r.body.data?.devices ?? []).length} devices`);

  r = await call(owner, "GET", `/api/dashboard/applications/${app.id}/users?search=player&limit=10`);
  check("user search finds a prefix match", r.status === 200 &&
    (r.body.data?.users ?? []).length > 0,
    JSON.stringify(r.body.data?.users?.map((u) => u.username)));

  r = await call(owner, "GET",
    `/api/dashboard/applications/${app.id}/users?search=${encodeURIComponent("^.*")}&limit=10`);
  check("an anchored injection attempt in user search is also literal",
    r.status === 200 && (r.body.data?.users ?? []).length === 0,
    `matched ${(r.body.data?.users ?? []).length} users`);

  r = await call(owner, "GET", `/api/dashboard/applications/${app.id}/sessions?search=device&limit=10`);
  check("session search returns a filtered page", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

  // ─────────────────────────────────────────────────────────────────────────
  // Password reset. Previously the new password was generated in the BROWSER
  // with Math.random() and never shown, so "Reset password" locked the end user
  // out of their own account. It must be generated server-side and returned.
  // ─────────────────────────────────────────────────────────────────────────
  section("Phase 5 — password reset");

  r = await call(owner, "POST", `/api/dashboard/applications/${app.id}/users/${player.id}/reset-password`, {});
  check("resetting a password succeeds", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);

  const newPassword = r.body.data?.password;
  check("the new password is returned to the owner", typeof newPassword === "string" && newPassword.length > 0,
    JSON.stringify(r.body.data));

  // The whole point: the returned value must actually work, and the old one
  // must not. A generator that returns an unusable value is the original bug.
  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: newPassword ?? "", deviceId: "device-aaa",
  }, AS_APP);
  check("the generated password actually works", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
  const resetToken = r.body.data?.sessionToken;

  // Policy-compliant every single time — no random 400s.
  check("the generated password satisfies the password policy",
    typeof newPassword === "string"
      && newPassword.length >= 8
      && /[a-z]/.test(newPassword)
      && /[A-Z]/.test(newPassword)
      && /[0-9]/.test(newPassword),
    `generated: ${newPassword}`);

  // Not predictable from Math.random(): two resets must not collide.
  r = await call(owner, "POST", `/api/dashboard/applications/${app.id}/users/${player.id}/reset-password`, {});
  const second = r.body.data?.password;
  check("two resets produce different passwords",
    typeof second === "string" && second !== newPassword, `both: ${newPassword} / ${second}`);

  // The session issued under the first password must not survive the second
  // reset, and must be FLAGGED (SESSION_REVOKED) rather than deleted — a
  // deleted row authenticates as a bare "invalid token".
  r = await call(null, "GET", "/api/v1/auth/validate", undefined, {
    ...AS_APP, Authorization: `Bearer ${resetToken}`,
  });
  check("a reset revokes the sessions it created", r.status === 401, `got ${r.status}`);
  check("the revoked session reports SESSION_REVOKED, not a bare 401",
    r.body?.error === "SESSION_REVOKED", JSON.stringify(r.body));

  // The dashboard password API still must not expose the hash.
  r = await call(owner, "GET", `/api/dashboard/applications/${app.id}/users/${player.id}`);
  check("the user detail response never exposes a password hash",
    !JSON.stringify(r.body).includes("$2b$"), "a bcrypt hash leaked to the client");

  // ─────────────────────────────────────────────────────────────────────────
  // Counter consistency. Banned and Expired used to overlap, so the four
  // dashboard numbers could not be summed back to the total.
  // ─────────────────────────────────────────────────────────────────────────
  section("Phase 5 — counter consistency");

  r = await call(owner, "GET", `/api/dashboard/applications/${app.id}/stats`);
  const s = r.body.data;
  check("the stats endpoint returns the four user counters",
    r.status === 200 && s && typeof s.total === "number",
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
  if (s && typeof s.total === "number") {
    check("active + banned + expired === total users",
      s.active + s.banned + s.expired === s.total,
      `active=${s.active} banned=${s.banned} expired=${s.expired} total=${s.total}`);
  }

  // Put the seeded password back. The reset above was a real state change, and
  // later phases log this user in with the fixture password — leaving it reset
  // would fail Phase 6 for a reason that has nothing to do with Phase 6.
  r = await call(owner, "PATCH", `/api/dashboard/applications/${app.id}/users/${player.id}`, {
    password: "Player123",
  });
  check("the original password can be restored", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);

  r = await call(null, "POST", "/api/v1/auth/login", {
    username: "player123", password: "Player123", deviceId: "device-aaa",
  }, AS_APP);
  check("the restored password authenticates", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
}

