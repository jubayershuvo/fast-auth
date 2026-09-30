import mongoose from "mongoose";

import { check, section, call, Session } from "../harness.mjs";

/**
 * Phase 21 — the end-user self-service portal.
 *
 * A fifth realm. Its point is that an ordinary person, signed in from a
 * browser, can look after ONE account: see when it expires, change their
 * password, see their devices and remove one that has been abandoned.
 *
 * The properties worth proving rather than assuming:
 *
 *   1. Sign-in issues its OWN cookie, and it is not interchangeable with the
 *      customer's — the realms must not be confused for one another
 *   2. Visiting the portal consumes NO licence seat
 *   3. There is no id anywhere to point at another account (no IDOR surface)
 *   4. Only the display name is updatable; owner controls are not
 *   5. THE IDLE RULE — a device active too recently cannot be deleted; an idle
 *      one can, and its sessions die with it
 *   6. Another user's device in the SAME application is untouchable
 *   7. A ban takes effect on an existing portal session immediately
 */
export async function phase21Portal(ctx) {
  section("Phase 21 — end-user self-service portal");
  const { owner, app } = ctx;

  await mongoose.connect(ctx.uri, { serverSelectionTimeoutMS: 15_000 });

  const deviceModel = mongoose.models.Device
    ?? mongoose.model("Device", new mongoose.Schema({
      applicationId: { type: mongoose.Schema.Types.ObjectId, index: true },
      userId: { type: mongoose.Schema.Types.ObjectId, index: true },
      deviceId: { type: String, required: true },
      deviceName: { type: String, default: null },
      firstSeenAt: { type: Date, default: Date.now },
      lastSeenAt: { type: Date, default: Date.now },
      lastIp: { type: String, default: null },
    }, { timestamps: true, collection: "devices" }), "devices");

  const anon = () => new Session();

  // ── 1. Sign in ─────────────────────────────────────────────────────────
  // A dedicated account, so nothing here disturbs the shared `player123`
  // fixture other phases depend on.
  let r = await call(owner, "POST", `/api/dashboard/applications/${app.id}/users`, {
    name: "Portal Person", username: "portalperson", password: "PortalPass1",
    maxDevices: 3,
  });
  check("a portal user is created", r.status === 201,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  const portalUserId = r.body?.data?.id;
  const userObjectId = () => new mongoose.Types.ObjectId(portalUserId);

  r = await call(anon(), "POST", "/api/portal/auth/login", {
    appId: app.appId, username: "portalperson", password: "PortalPass1",
  });
  check("the end user signs in to the portal", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  check("the response names the application",
    typeof r.body?.data?.applicationName === "string" &&
      r.body.data.applicationName.length > 0,
    // `ctx.app.name` is NOT compared here: phase 2 renames the application and
    // the ctx snapshot still holds the original name, so asserting against it
    // would fail on a value that is correct in production.
    JSON.stringify(r.body?.data));

  r = await call(anon(), "POST", "/api/portal/auth/login", {
    appId: app.appId, username: "portalperson", password: "wrong",
  });
  check("a wrong portal password is 401", r.status === 401, `got ${r.status}`);

  const portal = anon();
  r = await call(portal, "POST", "/api/portal/auth/login", {
    appId: app.appId, username: "portalperson", password: "PortalPass1",
  });
  check("the portal session signs in", r.status === 200, `got ${r.status}`);

  // ── 2. The portal session is its own realm ─────────────────────────────
  r = await call(portal, "GET", "/api/portal/me");
  check("the portal session can read its own account", r.status === 200,
    `got ${r.status}`);
  check("and it is the right account",
    r.body?.data?.user?.id === portalUserId,
    JSON.stringify(r.body?.data?.user?.id));

  // A portal cookie must NOT authenticate the customer dashboard. These are
  // separate realms and must not be interchangeable.
  r = await call(portal, "GET", "/api/dashboard/applications");
  check("a portal session cannot reach the customer dashboard API",
    r.status === 401 || r.status === 403, `got ${r.status}`);

  // ── 3. Visiting the portal consumes no licence seat ───────────────────
  const seats = await deviceModel.countDocuments({ userId: userObjectId() });
  check("signing in to the portal registered NO device", seats === 0,
    `${seats} device rows exist for a browser session`);

  // ── 4. Only the display name is updatable ──────────────────────────────
  r = await call(portal, "PATCH", "/api/portal/me", { name: "Renamed Person" });
  check("the end user can rename themselves", r.status === 200 &&
    r.body?.data?.user?.name === "Renamed Person",
    `got ${r.status} ${JSON.stringify(r.body?.data)}`);

  // Owner-controlled fields must be ignored, not applied. Zod strips unknown
  // keys, so a smuggled `expiresAt` or `maxDevices` never reaches the write.
  r = await call(portal, "PATCH", "/api/portal/me", {
    name: "Still Fine", isBanned: false, maxDevices: 99,
    expiresAt: "2099-01-01T00:00:00.000Z", notes: "injected",
  });
  check("smuggled owner-only fields are ignored, not rejected",
    r.status === 200, `got ${r.status} ${JSON.stringify(r.body?.data)}`);

  r = await call(portal, "GET", "/api/portal/me");
  check("the username is unchanged (it is the login handle)",
    r.body?.data?.user?.username === "portalperson",
    JSON.stringify(r.body?.data?.user?.username));
  check("maxDevices was NOT changed by the end user",
    r.body?.data?.user?.maxDevices === 3,
    JSON.stringify(r.body?.data?.user?.maxDevices));
  check("the owner's notes are never exposed to the end user",
    r.body?.data?.user?.notes === null,
    JSON.stringify(r.body?.data?.user?.notes));
  check("no password hash is ever returned",
    !JSON.stringify(r.body).includes("$2$"));

  // ── 5. Change password, with the step-up check ────────────────────────
  r = await call(portal, "POST", "/api/portal/password", {
    currentPassword: "WRONG", newPassword: "BrandNew123",
  });
  check("changing the password needs the CURRENT one",
    r.status === 401 && r.body?.error === "CURRENT_PASSWORD_INCORRECT",
    `got ${r.status} ${r.body?.error}`);

  // A live game-client session, so we can prove the change revokes it.
  r = await call(anon(), "POST", "/api/v1/auth/login", {
    username: "portalperson", password: "PortalPass1", deviceId: "portal-device-1",
  }, { "X-App-Id": app.appId });
  const clientToken = r.body?.data?.sessionToken;
  check("the same user has a live client session", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);

  r = await call(portal, "POST", "/api/portal/password", {
    currentPassword: "PortalPass1", newPassword: "PortalPass2",
  });
  check("the password changes with the correct current one", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);

  r = await call(portal, "GET", "/api/portal/me");
  check("the portal session SURVIVES its own password change",
    r.status === 200, `got ${r.status}`);

  // `/api/v1/auth/validate` is a GET; POST to it is a 405 and would prove nothing.
  // No body argument at all: `fetch` rejects a body on GET/HEAD outright.
  r = await call(anon(), "GET", "/api/v1/auth/validate", undefined,
    { "X-App-Id": app.appId, Authorization: `Bearer ${clientToken}` });
  check("the other device's session was revoked by the change",
    r.status === 401 || r.status === 403, `got ${r.status}`);

  // ── 6. Devices, and THE IDLE RULE ─────────────────────────────────────
  // Two real devices: one just active, one abandoned long ago.
  const fresh = await deviceModel.create({
    applicationId: app.id, userId: userObjectId(),
    deviceId: "fresh-device", deviceName: "In Use",
    firstSeenAt: new Date(), lastSeenAt: new Date(),
  });
  const stale = await deviceModel.create({
    applicationId: app.id, userId: userObjectId(),
    deviceId: "stale-device", deviceName: "Old Laptop",
    firstSeenAt: new Date(Date.now() - 5 * 86_400_000),
    lastSeenAt: new Date(Date.now() - 5 * 86_400_000),
  });

  r = await call(portal, "GET", "/api/portal/devices");
  check("the end user can list their own devices", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  const listed = r.body?.data?.devices ?? [];
  // Membership, not an exact count: section 5 above signed the same user in from
  // a real client, which legitimately registered a third device. Asserting
  // `length === 2` would be asserting that the earlier step did not happen.
  const ids = listed.map((d) => d.deviceId);
  check("both devices this phase created are listed",
    ids.includes("fresh-device") && ids.includes("stale-device"),
    JSON.stringify(ids));
  check("the idle window is reported to the client",
    r.body?.data?.idleMinutes === 60,
    JSON.stringify(r.body?.data?.idleMinutes));

  const byId = (id) => listed.find((d) => d.id === id);
  check("the server marks the RECENTLY active device as not deletable",
    byId(fresh._id.toString())?.canDelete === false,
    JSON.stringify(byId(fresh._id.toString())));
  check("and the long-idle device as deletable",
    byId(stale._id.toString())?.canDelete === true,
    JSON.stringify(byId(stale._id.toString())));

  // The rule must be enforced SERVER-side, not merely shown in the UI.
  r = await call(portal, "DELETE", `/api/portal/devices/${fresh._id}`);
  check("deleting a device active within the hour is refused (409)",
    r.status === 409, `got ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  check("and refused as DEVICE_STILL_ACTIVE",
    r.body?.error === "DEVICE_STILL_ACTIVE", String(r.body?.error));
  check("the device still exists after the refusal",
    (await deviceModel.countDocuments({ _id: fresh._id })) === 1);

  r = await call(portal, "DELETE", `/api/portal/devices/${stale._id}`);
  check("deleting an idle device succeeds", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  check("and the device row is gone",
    (await deviceModel.countDocuments({ _id: stale._id })) === 0);

  // ── 7. Another user's device is untouchable, in the SAME app ──────────
  const someoneElses = await deviceModel.create({
    applicationId: app.id, userId: new mongoose.Types.ObjectId(ctx.player.id),
    deviceId: "someone-elses", deviceName: "Not Yours",
    firstSeenAt: new Date(Date.now() - 9 * 86_400_000),
    lastSeenAt: new Date(Date.now() - 9 * 86_400_000),
  });
  r = await call(portal, "DELETE", `/api/portal/devices/${someoneElses._id}`);
  check("another user's device in the same app is NOT deletable (404)",
    r.status === 404, `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
  check("and it still exists",
    (await deviceModel.countDocuments({ _id: someoneElses._id })) === 1);

  r = await call(portal, "GET", "/api/portal/devices");
  check("another user's device never appears in the portal list",
    !(r.body?.data?.devices ?? []).some((d) => d.deviceId === "someone-elses"),
    JSON.stringify(r.body?.data?.devices?.map((d) => d.deviceId)));

  // A malformed id never reaches Mongo.
  r = await call(portal, "DELETE", "/api/portal/devices/not-an-object-id");
  check("a malformed device id is a 400", r.status === 400, `got ${r.status}`);

  // ── 8. A ban kills an EXISTING portal session immediately ─────────────
  r = await call(portal, "GET", "/api/portal/me");
  check("the portal session works before the ban", r.status === 200,
    `got ${r.status}`);

  r = await call(owner, "POST",
    `/api/dashboard/applications/${app.id}/users/${portalUserId}/ban`,
    { reason: "portal phase test" });
  check("the owner can ban the account", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);

  // The cookie is still cryptographically valid here. Only the re-read ban
  // check stops it — which is the whole reason `getPortalUser` never trusts
  // sign-in-time state.
  r = await call(portal, "GET", "/api/portal/me");
  check("a ban takes effect on an ALREADY-ISSUED portal session",
    r.status === 401, `got ${r.status}`);

  r = await call(anon(), "POST", "/api/portal/auth/login", {
    appId: app.appId, username: "portalperson", password: "PortalPass2",
  });
  check("and a banned user cannot sign in again",
    r.status === 403 && r.body?.error === "ACCOUNT_BANNED",
    `got ${r.status} ${r.body?.error}`);

  // ── 9. Sign out, and the anonymous case ──────────────────────────────
  const other = anon();
  await call(other, "POST", "/api/portal/auth/login", {
    appId: app.appId, username: ctx.player.username, password: "Player123",
  });
  r = await call(other, "GET", "/api/portal/me");
  check("a second end user can sign in too", r.status === 200, `got ${r.status}`);

  r = await call(other, "POST", "/api/portal/auth/logout");
  check("sign out succeeds", r.status === 200, `got ${r.status}`);
  r = await call(other, "GET", "/api/portal/me");
  check("and the session is dead afterwards", r.status === 401, `got ${r.status}`);

  // No session at all: every protected route must refuse, and the Proxy must
  // answer JSON (never a redirect) for API paths.
  r = await call(anon(), "GET", "/api/portal/me");
  check("an anonymous portal API call is 401", r.status === 401, `got ${r.status}`);
  r = await call(anon(), "POST", "/api/portal/password", {
    currentPassword: "x", newPassword: "y",
  });
  check("an anonymous password change is 401", r.status === 401, `got ${r.status}`);
  r = await call(anon(), "GET", "/api/portal/devices");
  check("an anonymous device list is 401", r.status === 401, `got ${r.status}`);

  // ── 10. The per-application URL is the tenancy boundary ───────────────
  // The cookie is a SINGLE shared `fa_app_session`, but the URL names an
  // application. These assertions are the reason that is safe: a session for
  // app A must not satisfy app B's dashboard, in either direction.
  const wrongAppAnon = await call(new Session(), "GET",
    `/apps/${app.appId}/dashboard`, undefined, undefined, { redirect: "manual" });
  check("a signed-out visitor is bounced from an app dashboard",
    wrongAppAnon.status === 307 || wrongAppAnon.status === 302,
    `got ${wrongAppAnon.status}`);
  check("and lands on THAT application's sign-in page",
    (wrongAppAnon.headers.get("location") ?? "").includes(
      `/apps/${app.appId}/login`),
    wrongAppAnon.headers.get("location") ?? "no location header");

  // The sign-in page itself must render for anyone. `call` returns PARSED json,
  // so an HTML page arrives as `{ raw: text }`.
  const signInHtml = await call(new Session(), "GET", `/apps/${app.appId}/login`);
  const signInSource = signInHtml.body?.raw ?? "";
  check("the application's sign-in page renders while signed out",
    signInHtml.status === 200 && signInSource.includes("Sign in"),
    `got ${signInHtml.status}`);
  check("and it does NOT ask for an application id — that is in the URL",
    !signInSource.includes("Application ID"),
    "the sign-in form still has an application-id field");
  check("and it does show the application it belongs to",
    signInSource.includes("MyGame"),
    "the sign-in page does not name the application");

  // An unknown application is a 404, not a login form that could never work.
  const unknown = await call(new Session(), "GET", "/apps/fa_doesnotexist00/login");
  check("an unknown application id is a 404", unknown.status === 404,
    `got ${unknown.status}`);

  // A session minted HERE, deliberately. Both earlier sessions are dead by this
  // point: `portal` was killed by the ban in section 8 and `other` was signed
  // out in section 9. Against a dead cookie every assertion below would pass for
  // the wrong reason — the redirect happens because there is no session at all,
  // not because the application check works.
  const live = anon();
  const signedIn = await call(live, "POST", "/api/portal/auth/login", {
    appId: app.appId, username: ctx.player.username, password: "Player123",
  });
  check("a live portal session for app A was established", signedIn.status === 200,
    `got ${signedIn.status} ${JSON.stringify(signedIn.body).slice(0, 140)}`);

  //
  // `redirect: "manual"` everywhere, because fetch FOLLOWS a redirect by
  // default and would report the destination's 200 as a rendered dashboard.
  const wrongApp = await call(live, "GET", `/apps/${ctx.app2.appId}/dashboard`,
    undefined, undefined, { redirect: "manual" });
  check("a LIVE session for app A does NOT satisfy app B's dashboard",
    wrongApp.status === 307 || wrongApp.status === 302, `got ${wrongApp.status}`);
  check("and is sent to app B's own sign-in page",
    (wrongApp.headers.get("location") ?? "").includes(
      `/apps/${ctx.app2.appId}/login`),
    wrongApp.headers.get("location") ?? "no location header");

  // App A's OWN dashboard still works: the guard must not break the legitimate
  // case it exists to permit.
  const ownDashboard = await call(live, "GET", `/apps/${app.appId}/dashboard`,
    undefined, undefined, { redirect: "manual" });
  check("the session still opens its OWN application's dashboard",
    ownDashboard.status === 200, `got ${ownDashboard.status}`);
  const dashboardHtml = ownDashboard.body?.raw ?? "";
  check("and it renders the expiry panel", dashboardHtml.includes("Expires"),
    "the dashboard did not render");
  check("and the device section",
    dashboardHtml.includes("Your devices"), "the device card is missing");

  // And the sign-in page bounces a signed-in visitor of THAT app onward, so it
  // is not shown a form they do not need.
  const bounce = await call(live, "GET", `/apps/${app.appId}/login`,
    undefined, undefined, { redirect: "manual" });
  check("a signed-in visitor is redirected past their own sign-in page",
    bounce.status === 307 || bounce.status === 302, `got ${bounce.status}`);
  check("to that application's dashboard",
    (bounce.headers.get("location") ?? "").includes(
      `/apps/${app.appId}/dashboard`),
    bounce.headers.get("location") ?? "no location header");

  // …but a signed-in visitor to a DIFFERENT app's sign-in page still gets the
  // form, because their cookie cannot satisfy that application.
  const otherLogin = await call(live, "GET", `/apps/${ctx.app2.appId}/login`,
    undefined, undefined, { redirect: "manual" });
  check("but a different app's sign-in page is still shown",
    otherLogin.status === 200, `got ${otherLogin.status}`);

  // ── 11. Leave no device rows behind ───────────────────────────────────
  // This phase registers a real client device and inserts two more directly.
  // Phase 5 asserts on the APPLICATION-WIDE device count, so anything left here
  // would silently break it. Removing exactly what this phase added keeps the
  // phase independent of where it is scheduled.
  const ours = ["portal-device-1", "fresh-device", "someone-elses"];
  const leftover = await deviceModel.deleteMany({ deviceId: { $in: ours } });
  check("this phase removed the device rows it created",
    leftover.deletedCount === ours.length,
    `removed ${leftover.deletedCount} of ${ours.length}`);

  await mongoose.disconnect();
}