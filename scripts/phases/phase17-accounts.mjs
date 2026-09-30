import mongoose from "mongoose";

import { check, section, call, Session, SESSION_SECRET } from "../harness.mjs";
import { lastCodeFor, readOutbox } from "../mail-inbox.mjs";

/**
 * Phase 17 — one account model, two provenances, and emailed codes.
 *
 * The claim under test is that there is ONE customer model: an account an
 * operator creates through the API-key realm and one a person registers on the
 * signup form are the same row, and the ONLY thing that differs is whether a
 * password exists.
 *
 *   platform-created -> no password -> sign in answers NO_PASSWORD_SET
 *                    -> request a code by email -> set a password
 *                    -> from then on it is an ordinary account
 *
 *   self-registered  -> password set  -> sign in refused until the emailed
 *                                        verification code is entered
 */
export async function phase17Accounts(ctx) {
  section("Phase 17 — one account model, email verification, claimed passwords");

  await mongoose.connect(ctx.uri, { serverSelectionTimeoutMS: 15_000 });

  /**
   * Schemas declared inline, exactly as phase 16 and `create-admin.mjs` do.
   *
   * The suite runs under plain Node with no TypeScript loader, so it cannot
   * import `models/*.ts` — attempting it pulls mongoose's CommonJS build into
   * an ESM context and fails on its named exports. The field names and
   * collection match the app's schema.
   */
  const apiKeyModel = mongoose.models.ApiKey
    ?? mongoose.model("ApiKey", new mongoose.Schema({
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
    }, { timestamps: true, collection: "api_keys" }), "api_keys");

  const userModel = mongoose.models.User
    ?? mongoose.model("User", new mongoose.Schema({
      email: { type: String, index: true },
      username: String,
      name: String,
      passwordHash: { type: String, default: null },
      authSource: { type: String, default: "self" },
      emailVerified: { type: Boolean, default: false },
      emailVerifiedAt: { type: Date, default: null },
      plan: String,
    }, { timestamps: true, collection: "users" }), "users");

  const { createHash, randomBytes } = await import("node:crypto");

  /**
   * Mint a platform key so this phase can create an account the "operator" way.
   * Same document and hash as `npm run create-api-key` / phase 16.
   */
  const platformKey = `fak_${randomBytes(32).toString("base64url")}`;
  await apiKeyModel.create({
    name: "suite-phase17",
    keyHash: createHash("sha256")
      .update(`${SESSION_SECRET}:${platformKey}`, "utf8")
      .digest("hex"),
    keyPrefix: platformKey.slice(0, 10),
    keyFingerprint: platformKey.slice(-4),
    scope: "platform",
    applicationId: null,
  });

  const keyed = (method, path, body) =>
    call(null, method, path, body, { "X-Api-Key": platformKey });
  const anon = () => new Session();

  // ── 1. A platform key creates an account with NO password ─────────────
  const email = "platform-made@fastauth.test";
  let r = await keyed("POST", "/api/keys/customers", {
    name: "Pat Platform", email, username: "platformmade",
  });
  check("a platform key creates a customer account (201)", r.status === 201,
    `got ${r.status} ${JSON.stringify(r.body)}`);

  const created = r.body?.data?.user;
  check("it is reported as having NO password",
    created?.hasPassword === false && r.body?.data?.passwordSet === false,
    JSON.stringify(r.body?.data));
  check("it is flagged authSource=platform",
    created?.authSource === "platform", JSON.stringify(created));
  check("it is created already verified",
    created?.emailVerified === true, JSON.stringify(created));

  // ── 2. ONE model: the row is in `users`, like any other account ───────
  const stored = await userModel.findOne({ email }).select("+passwordHash").lean();
  check("the account lives in the shared `users` collection", Boolean(stored));
  check("its passwordHash is genuinely null",
    stored?.passwordHash === null, String(stored?.passwordHash));
  check("no hash is ever exposed to the client",
    !JSON.stringify(r.body).includes("$2$"), JSON.stringify(r.body).slice(0, 120));

  // ── 3. Signing in with a password says so, specifically ───────────────
  r = await call(anon(), "POST", "/api/auth/login", {
    identifier: email, password: "Anything123",
  });
  check("signing in with a password is refused (409)",
    r.status === 409, `got ${r.status}`);
  check("it is refused as NO_PASSWORD_SET",
    r.body?.error === "NO_PASSWORD_SET", String(r.body?.error));
  check("the message points at the fix, not a dead end",
    typeof r.body?.message === "string" && r.body.message.length > 0);

  // The critical one: an absent password must never read as a MATCH.
  r = await call(anon(), "POST", "/api/auth/login", {
    identifier: email, password: "",
  });
  check("an empty password is refused too, never accepted",
    r.status === 409 || r.status === 400 || r.status === 401, `got ${r.status}`);

  // ── 4. Requesting a code ──────────────────────────────────────────────
  r = await call(anon(), "POST", "/api/auth/set-password/request", { email });
  check("a setup code is requested successfully (200)", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body)}`);

  const code = lastCodeFor(email);
  check("a 6-digit code was emailed to the account", Boolean(code), `got ${code}`);

  // ── 5. The code is required, and a wrong one is refused ───────────────
  r = await call(anon(), "POST", "/api/auth/set-password/confirm", {
    email, code: code === "000000" ? "111111" : "000000", password: "Claimed123",
  });
  check("a wrong code is refused (400)",
    r.status === 400 && r.body?.error === "INVALID_VERIFICATION_CODE",
    `got ${r.status} ${r.body?.error}`);

  const stillNone = await userModel.findOne({ email }).select("+passwordHash").lean();
  check("a wrong code writes no password",
    stillNone?.passwordHash === null, String(stillNone?.passwordHash));

  // ── 5b. The refusal NAMES the platform the account belongs to ─────────
  // The sign-in screen turns this list into "registered with Google, continue
  // with Google" instead of a dead "incorrect password". It has to be present on
  // the same 409 that already fires, or the dialog has nothing to show.
  const oauthAccountModel = mongoose.models.OAuthAccount
    ?? mongoose.model("OAuthAccount", new mongoose.Schema({
      provider: { type: String, required: true, enum: ["google", "github", "azure"] },
      providerAccountId: { type: String, required: true },
      realm: { type: String, required: true, enum: ["customer", "admin"] },
      userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
      email: { type: String, default: null },
      displayName: { type: String, default: null },
      avatarUrl: { type: String, default: null },
    }, { timestamps: true, collection: "oauth_accounts" }), "oauth_accounts");

  // An operator-made account is NOT a social sign-up, so there is nothing to
  // name. The key must still be present and simply empty — a missing key would
  // make the client guess whether the server is old or the account is odd.
  r = await call(anon(), "POST", "/api/auth/login", {
    identifier: email, password: "Anything123",
  });
  check("an account with no provider link reports an EMPTY provider list",
    r.status === 409
      && Array.isArray(r.body?.details?.providers)
      && r.body.details.providers.length === 0,
    `got ${r.status} ${JSON.stringify(r.body?.details)}`);

  // Now link it to Google and prove the name comes back.
  await oauthAccountModel.create({
    provider: "google",
    providerAccountId: "google-subject-phase17",
    realm: "customer",
    userId: stillNone._id,
    email,
  });

  r = await call(anon(), "POST", "/api/auth/login", {
    identifier: email, password: "Anything123",
  });
  check("a Google-linked account is refused with NO_PASSWORD_SET still",
    r.status === 409 && r.body?.error === "NO_PASSWORD_SET",
    `got ${r.status} ${r.body?.error}`);
  check("and the refusal NAMES the provider, so the screen can offer it",
    Array.isArray(r.body?.details?.providers)
      && r.body.details.providers.includes("google"),
    JSON.stringify(r.body?.details));

  // It must never leak the provider's own subject id — that is a credential-
  // adjacent identifier and has no business in a login failure.
  check("the refusal does not leak the provider account id",
    !JSON.stringify(r.body).includes("google-subject-phase17"),
    JSON.stringify(r.body).slice(0, 200));

  // Clean up: phase 5 counts devices/accounts application-wide, and the later
  // sections of THIS phase sign in with a password, which this link would not
  // affect — but leaving rows behind is how phases become order-dependent.
  await oauthAccountModel.deleteMany({ providerAccountId: "google-subject-phase17" });

  // ── 6. The right code claims the password and signs in ────────────────
  const claimer = anon();
  r = await call(claimer, "POST", "/api/auth/set-password/confirm", {
    email, code, password: "Claimed123",
  });
  check("the correct code sets the password (200)", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body)}`);
  check("the account is signed in as a side effect",
    (await call(claimer, "GET", "/api/auth/me")).status === 200);

  const claimed = await userModel.findOne({ email }).select("+passwordHash").lean();
  check("a bcrypt hash is now stored", String(claimed?.passwordHash).startsWith("$2"),
    String(claimed?.passwordHash).slice(0, 8));

  // ── 7. From here it is an ordinary account ────────────────────────────
  r = await call(anon(), "POST", "/api/auth/login", {
    identifier: email, password: "Claimed123",
  });
  check("the claimed password now signs in normally", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body)}`);

  r = await call(anon(), "POST", "/api/auth/login", {
    identifier: email, password: "WrongPass1",
  });
  check("a wrong password is still refused on a claimed account",
    r.status === 401 && r.body?.error === "INVALID_CREDENTIALS",
    `got ${r.status} ${r.body?.error}`);

  // ── 8. The setup flow cannot be used to hijack a real account ────────
  // A registered account already HAS a password; treating a setup request as a
  // reset would let anyone who knew the address overwrite a working credential.
  // Count only the MESSAGES, not "any code for this address": phase 1 already
  // emailed `owner@example.com` a `verify_email` code, so `lastCodeFor` is
  // non-null for reasons that have nothing to do with this flow. What matters is
  // that requesting a setup code for an account that already has a password
  // adds NO new message.
  const beforeCount = readOutbox().filter((m) => m.to === "owner@example.com").length;
  r = await call(anon(), "POST", "/api/auth/set-password/request", {
    email: "owner@example.com",
  });
  check("a setup request for an account that HAS a password still returns 200",
    r.status === 200, `got ${r.status}`);
  const afterCount = readOutbox().filter((m) => m.to === "owner@example.com").length;
  check("but no code is emailed for it", afterCount === beforeCount,
    `${beforeCount} -> ${afterCount} messages`);

  r = await call(anon(), "POST", "/api/auth/set-password/confirm", {
    email: "owner@example.com", code: "123456", password: "Hijack123",
  });
  check("confirming is refused for an account that already has a password",
    r.status === 409 && r.body?.error === "NO_PASSWORD_SET",
    `got ${r.status} ${r.body?.error}`);

  const owner = await userModel.findOne({ email: "owner@example.com" })
    .select("+passwordHash").lean();
  check("the original account's password is untouched",
    String(owner?.passwordHash).startsWith("$2"),
    String(owner?.passwordHash).slice(0, 8));

  // ── 9. Unknown addresses are indistinguishable ────────────────────────
  const ghost = await call(anon(), "POST", "/api/auth/set-password/request", {
    email: "nobody-here@fastauth.test",
  });
  const real = await call(anon(), "POST", "/api/auth/set-password/request", { email });
  check("an unknown address gets the same response as a real one",
    ghost.status === real.status && ghost.body?.data?.message === real.body?.data?.message,
    `${ghost.status} vs ${real.status}`);

  // ── 10. A second code invalidates the first ──────────────────────────
  // This is where "single use" is actually enforced: only the newest code can
  // ever succeed, so a leaked older one is worthless.
  const second = "second-made@fastauth.test";
  r = await keyed("POST", "/api/keys/customers", {
    name: "Sam Second", email: second, username: "secondmade",
  });
  check("a second platform account is created", r.status === 201, `got ${r.status}`);

  await call(anon(), "POST", "/api/auth/set-password/request", { email: second });
  const staleCode = lastCodeFor(second);
  await call(anon(), "POST", "/api/auth/set-password/request", { email: second });
  const freshCode = lastCodeFor(second);
  check("requesting again issues a new code", Boolean(freshCode));
  check("the two codes differ", staleCode !== freshCode,
    `${staleCode} vs ${freshCode}`);

  r = await call(anon(), "POST", "/api/auth/set-password/confirm", {
    email: second, code: staleCode, password: "Stale1234",
  });
  check("the SUPERSEDED code no longer works", r.status === 400,
    `got ${r.status} ${r.body?.error}`);

  r = await call(anon(), "POST", "/api/auth/set-password/confirm", {
    email: second, code: freshCode, password: "Fresh1234",
  });
  check("the newest code does work", r.status === 200, `got ${r.status}`);

  // ── 11. A spent code cannot be reused ────────────────────────────────
  r = await call(anon(), "POST", "/api/auth/set-password/confirm", {
    email: second, code: freshCode, password: "Other1234",
  });
  check("a spent code cannot be reused", r.status === 409 || r.status === 400,
    `got ${r.status}`);

  // ── 12. The platform key is required to create accounts ──────────────
  r = await call(anon(), "POST", "/api/keys/customers", {
    name: "No Key", email: "nokey@fastauth.test", username: "nokeyuser",
  });
  check("creating an account without an API key is refused (401)",
    r.status === 401, `got ${r.status}`);

  await mongoose.disconnect();
}
