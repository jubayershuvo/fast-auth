import mongoose from "mongoose";

import { check, section, call, registerAndVerify, Session, BASE, SESSION_SECRET } from "../harness.mjs";

/**
 * Phase 16 — the API-key (machine) realm.
 *
 * These routes are what a customer's BACKEND calls, so the suite drives them
 * the way a script would: no cookie jar, just an `X-Api-Key` header. That alone
 * proves the fourth credential path is genuinely separate — if any handler fell
 * back to the session cookie, every check here would 401.
 *
 * The heart of the phase is the SCOPE assertions, not the happy path:
 *   - an app key cannot reach another application (404, not 403)
 *   - an app key cannot list every application (403)
 *   - no HTTP endpoint can mint a key
 */

/**
 * Schemas declared inline, exactly as `create-admin.mjs` does.
 *
 * The suite runs under plain Node with no TypeScript loader, so it cannot
 * import `models/*.ts`. The field names, index and collection match the app's
 * schema — the same trade-off, and the same reasoning, as the admin CLI.
 */
const API_KEY_SCHEMA = new mongoose.Schema(
  {
    name: { type: String, required: true },
    keyHash: { type: String, required: true, index: true },
    keyPrefix: { type: String, required: true },
    keyFingerprint: { type: String, required: true },
    scope: { type: String, enum: ["platform", "app"], required: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, default: null },
    expiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
    lastUsedIp: { type: String, default: null },
  },
  { timestamps: true, collection: "api_keys" },
);

/** Call a /api/keys route with a raw key and no cookie session. */
function keyed(key, method, path, body) {
  return call(null, method, path, body, key ? { "X-Api-Key": key } : {});
}

/**
 * Mint a key the way `npm run create-api-key` does, but in-process.
 *
 * The CLI is the only ISSUER in a real deployment; the suite needs several keys
 * with different scopes and cannot afford to shell out per case. It writes the
 * same document the CLI writes, hashed with the same algorithm, so what is
 * verified here is genuinely the production format.
 */
async function mintKey(ApiKey, { name, scope, applicationId = null, expiresAt = null }) {
  const { createHash, randomBytes } = await import("node:crypto");

  const plaintext = `fak_${randomBytes(32).toString("base64url")}`;
  // Identical to hashToken() in lib/tokens.ts: sha256(`${SESSION_SECRET}:${key}`).
  // SESSION_SECRET is the shared harness constant the SERVER was started with —
  // reading a different value here would produce hashes it can never match.
  const keyHash = createHash("sha256")
    .update(`${SESSION_SECRET}:${plaintext}`, "utf8")
    .digest("hex");

  await ApiKey.create({
    name,
    keyHash,
    keyPrefix: plaintext.slice(0, 10),
    keyFingerprint: plaintext.slice(-4),
    scope,
    applicationId,
    expiresAt,
  });
  return plaintext;
}

/** Log an end user in through the public v1 API (no API key involved). */
async function v1Login(publicAppId, username, password, deviceId) {
  const response = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-App-Id": publicAppId },
    body: JSON.stringify({ username, password, deviceId }),
  });
  return { status: response.status, body: await response.json() };
}

export async function phase16ApiKeys(ctx) {
  section("Phase 16 — API keys: the machine realm");

  await mongoose.connect(ctx.uri, { serverSelectionTimeoutMS: 15_000 });
  const ApiKey = mongoose.models.ApiKey
    ?? mongoose.model("ApiKey", API_KEY_SCHEMA, "api_keys");

  // `ctx.app` / `ctx.app2` are the full create-application responses, so the
  // fixtures are already resolved — no query needed.
  const appA = ctx.app;
  const appB = ctx.app2;
  check("both fixture applications resolved",
    Boolean(appA?.id && appB?.id));
  check("the two fixture applications are different tenants' objects",
    appA?.id !== appB?.id);

  // ── 1. No key at all is refused ───────────────────────────────────────
  const anonymous = await keyed(null, "GET", "/api/keys/me");
  check("a request with no key is refused (401)",
    anonymous.status === 401, `got ${anonymous.status}`);
  check("it is refused as INVALID_API_KEY",
    anonymous.body?.error === "INVALID_API_KEY", String(anonymous.body?.error));

  const garbage = await keyed("fak_totally-made-up-value", "GET", "/api/keys/me");
  check("a bogus key is refused (401)", garbage.status === 401,
    `got ${garbage.status}`);

  // ── 2. /me reports the scope honestly ─────────────────────────────────
  const platformKey = await mintKey(ApiKey, { name: "suite-platform", scope: "platform" });
  const appKey = await mintKey(ApiKey, {
    name: "suite-app", scope: "app", applicationId: appA.id,
  });

  const mePlatform = await keyed(platformKey, "GET", "/api/keys/me");
  check("a platform key authenticates", mePlatform.status === 200,
    `got ${mePlatform.status}`);
  check("it reports scope 'platform'",
    mePlatform.body?.data?.key?.scope === "platform",
    JSON.stringify(mePlatform.body?.data?.key));
  check("it is not pinned to an application",
    mePlatform.body?.data?.key?.applicationId === null);

  const meApp = await keyed(appKey, "GET", "/api/keys/me");
  check("an app key authenticates", meApp.status === 200,
    `got ${meApp.status}`);
  check("it reports scope 'app'", meApp.body?.data?.key?.scope === "app");
  check("it names the application it is pinned to",
    meApp.body?.data?.key?.applicationId === appA.id.toString());

  // ── 3. A customer COOKIE must not work here ────────────────────────────
  // The realms are separate: this is what proves a stolen dashboard session
  // cannot be upgraded into server-to-server management.
  const owner = ctx.owner ?? new Session();
  const withCookie = await call(owner, "GET", "/api/keys/applications");
  check("a customer session cookie does NOT authenticate the key realm",
    withCookie.status === 401, `got ${withCookie.status}`);

  // ── 4. Platform key: manages all applications ─────────────────────────
  const allApps = await keyed(platformKey, "GET", "/api/keys/applications");
  check("a platform key lists every application", allApps.status === 200,
    `got ${allApps.status}`);
  check("it sees BOTH tenants' applications",
    allApps.body?.data?.applications?.length >= 2,
    `saw ${allApps.body?.data?.applications?.length}`);

  const listed = allApps.body?.data?.applications ?? [];
  check("the listing never contains an app secret",
    listed.every((a) => a.appSecret === undefined && a.appSecretHash === undefined));

  // ── 5. App key: CANNOT list every application ─────────────────────────
  const appList = await keyed(appKey, "GET", "/api/keys/applications");
  check("an app key is refused the cross-tenant listing (403)",
    appList.status === 403, `got ${appList.status}`);
  check("it is refused as API_KEY_SCOPE_DENIED",
    appList.body?.error === "API_KEY_SCOPE_DENIED", String(appList.body?.error));

  // ── 6. The cross-tenant IDOR guard — the important one ────────────────
  // A SECOND, genuinely different customer. `ctx.app2` belongs to the SAME owner
  // as `ctx.app` (see phase 2), so reaching it would be legitimate and would
  // prove nothing — the key would simply be allowed to go there.
  const stranger = new Session();
  await registerAndVerify(stranger, {
    name: 'Sam Stranger', email: 'stranger@example.com',
    username: 'stranger', password: 'Stranger123',
  });
  const strangerApp = await call(stranger, 'POST', '/api/dashboard/applications',
    { name: 'Stranger App' });
  check('a second, independent customer exists for the IDOR test',
    strangerApp.status === 201, `got ${strangerApp.status}`);
  const strangerAppId = strangerApp.body?.data?.id;

  const crossRead = await keyed(appKey, 'GET',
    `/api/keys/applications/${strangerAppId}`);
  check("an app key cannot read ANOTHER TENANT's application (404)",
    crossRead.status === 404, `got ${crossRead.status}`);

  const crossWrite = await keyed(appKey, 'POST',
    `/api/keys/applications/${strangerAppId}/users`,
    { username: 'intruder', name: 'Intruder', password: 'Intruder1' });
  check('an app key cannot create users in ANOTHER TENANT (404)',
    crossWrite.status === 404, `got ${crossWrite.status}`);

  // The intruder must genuinely not exist in the other tenant.
  const strangerUsers = await call(stranger, 'GET',
    `/api/dashboard/applications/${strangerAppId}/users`);
  check('no user was actually created in the other tenant',
    !(strangerUsers.body?.data?.users ?? []).some((u) => u.username === 'intruder'),
    JSON.stringify(strangerUsers.body?.data?.users));

  // A nonexistent id must look identical, or the API becomes an id oracle.
  const missing = await keyed(appKey, 'GET',
    '/api/keys/applications/000000000000000000000000');
  check('an unknown application id is also 404', missing.status === 404,
    `got ${missing.status}`);
  check('a cross-tenant read and an unknown id are indistinguishable',
    JSON.stringify(crossRead.body) === JSON.stringify(missing.body));

  // ── 7. App key: manages ITS OWN users and devices ─────────────────────
  const ownRead = await keyed(appKey, "GET", `/api/keys/applications/${appA.id}`);
  check("an app key CAN read its own application", ownRead.status === 200,
    `got ${ownRead.status}`);

  const created = await keyed(appKey, "POST",
    `/api/keys/applications/${appA.id}/users`,
    { username: "keymade", name: "Key Made", password: "KeyMade1", maxDevices: 2 });
  check("an app key CAN create a user in its own application",
    created.status === 201, `got ${created.status} ${JSON.stringify(created.body)}`);

  const userId = created.body?.data?.user?.id;
  check("the new user has an id", Boolean(userId));

  // A password issued through this path must actually work for the end user.
  const login = await v1Login(appA.appId, "keymade", "KeyMade1", "keymade-device-01");
  check("a key-created user can actually log in through /api/v1",
    login.status === 200 && Boolean(login.body?.data?.sessionToken),
    `got ${login.status}`);

  const devices = await keyed(appKey, "GET", `/api/keys/applications/${appA.id}/devices`);
  check("an app key lists devices in its own application",
    devices.status === 200, `got ${devices.status}`);
  check("the device registered at login is visible",
    (devices.body?.data?.devices ?? []).some((d) => d.deviceId === "keymade-device-01"));

  // ── 8. The ban / unban / delete lifecycle, all via the key ────────────
  const ban = await keyed(appKey, "POST",
    `/api/keys/applications/${appA.id}/users/${userId}/ban`,
    { reason: "suite" });
  check("an app key can ban a user", ban.status === 200, `got ${ban.status}`);
  check("the ban is recorded on the user",
    ban.body?.data?.user?.isBanned === true);

  const banned = await v1Login(appA.appId, "keymade", "KeyMade1", "keymade-device-02");
  check("the banned user is refused at login (ACCOUNT_BANNED)",
    banned.status === 403 && banned.body?.error === "ACCOUNT_BANNED",
    `got ${banned.status} ${banned.body?.error}`);

  const unban = await keyed(appKey, "POST",
    `/api/keys/applications/${appA.id}/users/${userId}/unban`, {});
  check("an app key can lift the ban",
    unban.status === 200 && unban.body?.data?.user?.isBanned === false,
    `got ${unban.status}`);

  const del = await keyed(appKey, "DELETE",
    `/api/keys/applications/${appA.id}/users/${userId}`);
  check("an app key can delete the user", del.status === 200, `got ${del.status}`);

  const gone = await keyed(appKey, "GET",
    `/api/keys/applications/${appA.id}/users/${userId}`);
  check("the deleted user is gone (404)", gone.status === 404, `got ${gone.status}`);

  // ── 9. An app key must not be able to create an application ───────────
  // The stranger, not `findOne()`: the oldest account is already at its Free
  // plan cap from earlier phases, which would make section 10 fail for the
  // wrong reason. `ownerId` is the id a platform key names explicitly.
  const strangerMe = await call(stranger, "GET", "/api/auth/me");
  const ownerId = strangerMe.body?.data?.id;
  check("the second customer's id was resolved for ownerId",
    typeof ownerId === "string", JSON.stringify(strangerMe.body));

  const createAttempt = await keyed(appKey, "POST", "/api/keys/applications",
    { ownerId, name: "Sneaky" });
  check("an app key cannot create an application (403)",
    createAttempt.status === 403, `got ${createAttempt.status}`);

  // ── 10. A platform key can create, and business rules still apply ─────
  const createdApp = await keyed(platformKey, "POST", "/api/keys/applications",
    { ownerId, name: "KeyCreated", description: "via api key" });
  check("a platform key can create an application",
    createdApp.status === 201,
    `got ${createdApp.status} ${JSON.stringify(createdApp.body)}`);
  check("the secret is returned exactly once, on create",
    typeof createdApp.body?.data?.application?.appSecret === "string");
  check("the new application has a public appId",
    typeof createdApp.body?.data?.application?.appId === "string");

  const newAppId = createdApp.body?.data?.application?.id;
  const readBack = await keyed(platformKey, "GET", `/api/keys/applications/${newAppId}`);
  check("the platform key can read back what it created",
    readBack.status === 200, `got ${readBack.status}`);

  const renamed = await keyed(platformKey, "PATCH",
    `/api/keys/applications/${newAppId}`, { name: "KeyCreated v2" });
  check("a platform key can rename it",
    renamed.status === 200 && renamed.body?.data?.application?.name === "KeyCreated v2",
    `got ${renamed.status}`);

  const stopped = await keyed(platformKey, "PATCH",
    `/api/keys/applications/${newAppId}/status`, { status: "suspended" });
  check("a platform key can stop it",
    stopped.status === 200 && stopped.body?.data?.application?.status === "suspended",
    `got ${stopped.status}`);

  const removed = await keyed(platformKey, "DELETE",
    `/api/keys/applications/${newAppId}`);
  check("a platform key can delete it", removed.status === 200, `got ${removed.status}`);

  // ── 11. Creation requires a REAL owner ────────────────────────────────
  const ghost = await keyed(platformKey, "POST", "/api/keys/applications",
    { ownerId: "000000000000000000000000", name: "Ghost" });
  check("creating an application for a non-existent owner is refused (400)",
    ghost.status === 400, `got ${ghost.status}`);

  // ── 12. Revoked and expired keys stop working immediately ─────────────
  const revokedKey = await mintKey(ApiKey, { name: "suite-revoked", scope: "platform" });
  check("a freshly minted key works",
    (await keyed(revokedKey, "GET", "/api/keys/me")).status === 200);

  await ApiKey.updateMany(
    { name: "suite-revoked" },
    { $set: { revokedAt: new Date() } },
  );
  const afterRevoke = await keyed(revokedKey, "GET", "/api/keys/me");
  check("a revoked key is refused (401)", afterRevoke.status === 401,
    `got ${afterRevoke.status}`);

  const expiredKey = await mintKey(ApiKey, {
    name: "suite-expired", scope: "platform",
    expiresAt: new Date(Date.now() - 1000),
  });
  const afterExpiry = await keyed(expiredKey, "GET", "/api/keys/me");
  check("an expired key is refused (401)", afterExpiry.status === 401,
    `got ${afterExpiry.status}`);
  check("an expired key is indistinguishable from an unknown one",
    JSON.stringify(afterExpiry.body) === JSON.stringify(garbage.body));

  // ── 13. There is no HTTP endpoint that can MINT a key ──────────────────
  // The CLI is the only issuer. If any route could create one, any
  // registration flaw anywhere would become a full-platform compromise.
  for (const path of [
    "/api/keys",
    `/api/keys/applications/${appA.id}/keys`,
  ]) {
    const res = await keyed(platformKey, "POST", path,
      { name: "forged", scope: "platform" });
    check(`no endpoint can mint an API key at POST ${path}`,
      res.status === 404 || res.status === 405, `got ${res.status}`);
  }

  // ── 14. Secrets never leak ────────────────────────────────────────────
  const serialised = JSON.stringify(allApps.body);
  check("no bcrypt hash in the API-key responses", !serialised.includes("$2b$"));
  check("no key hash in the API-key responses", !serialised.includes("keyHash"));
  check("the plaintext key is never echoed back",
    !serialised.includes(platformKey) && !serialised.includes(appKey));

  await mongoose.disconnect();
}

