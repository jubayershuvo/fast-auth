import mongoose from "mongoose";

import { check, section, call, Session } from "../harness.mjs";
import { lastCodeFor, readOutbox } from "../mail-inbox.mjs";

/**
 * Phase 19 — forgotten password, with an emailed code.
 *
 * ONE flow for BOTH cases, which is the whole feature:
 *
 *   forgot one        -> a code is emailed and REPLACES the existing password
 *   never had one     -> the same code WRITES the first password
 *
 * and the caller cannot tell which happened. The request itself proves nothing,
 * and only someone who can read the mailbox can spend the code.
 *
 * The properties that MUST hold, and which a test has to prove rather than
 * assume:
 *
 *   1. It works for an account that HAS a password  (the forgot case)
 *   2. It works for an account that has NONE       (the set case)
 *   3. The old password stops working; the new one starts
 *   4. Every OTHER session is revoked — the whole point of a reset
 *   5. A `set_password` code cannot be spent as a `reset_password` one, or
 *      vice versa: the purpose is mixed into the stored hash
 *   6. The reply names only a MASKED address, never the full one
 *   7. Either an email OR a username identifies the account
 *   8. The code can be checked WITHOUT being spent, and a wrong guess still
 *      costs an attempt — otherwise that step is a free guessing oracle
 *   9. Success emails a notice and signs the browser straight in
 */
export async function phase19PasswordReset(ctx) {
  section("Phase 19 — forgot password (code), for both account kinds");

  await mongoose.connect(ctx.uri, { serverSelectionTimeoutMS: 15_000 });

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

  const anon = () => new Session();

  // ── CASE A: an account that HAS a password ────────────────────────────
  // Built directly rather than through registration, because the rate limiter
  // on signup is per-IP and earlier phases have already spent that budget.
  // The point of this case is the EXISTING hash, so the hash is what matters,
  // not how it got there.
  const forgotEmail = "forgot-existing@fastauth.test";
  const bcrypt = (await import("bcryptjs")).default;
  const originalHash = await bcrypt.hash("Original123", 12);
  await userModel.updateOne(
    { email: forgotEmail },
    {
      $set: {
        name: "Fred Forgotten", email: forgotEmail, username: "forgotexisting",
        passwordHash: originalHash, authSource: "self",
        emailVerified: true, emailVerifiedAt: new Date(),
      },
    },
    { upsert: true },
  );

  // The OLD password works right up to the reset — proof that the reset is
  // what changes it, and not a pre-existing broken account.
  let r = await call(anon(), "POST", "/api/auth/login", {
    identifier: forgotEmail, password: "Original123",
  });
  check("case A: the original password works before the reset",
    r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);

  // A second live session, so we can prove the reset kills it (property 4).
  const otherDevice = anon();
  r = await call(otherDevice, "POST", "/api/auth/login", {
    identifier: forgotEmail, password: "Original123",
  });
  check("case A: a second device signs in too", r.status === 200,
    `got ${r.status}`);
  r = await call(otherDevice, "GET", "/api/auth/me");
  check("case A: that second session is live before the reset",
    r.status === 200, `got ${r.status}`);

  // ── The response now names the destination, and that is a trade ───────
  // This USED to assert that the response was byte-identical for a known and an
  // unknown address. That guarantee is deliberately given up: the screen now
  // says WHERE the code went, so a person does not check the wrong inbox.
  // What replaces the old test is narrower and still worth having — the reply
  // must not carry the FULL address, and an unknown one must still be silent
  // about whether a mail was sent.
  const ghost = await call(anon(), "POST", "/api/auth/forgot-password", {
    identifier: "nobody-here@fastauth.test",
  });
  const known = await call(anon(), "POST", "/api/auth/forgot-password", {
    identifier: forgotEmail,
  });
  check("a request for an unknown address still returns 200",
    ghost.status === 200, `got ${ghost.status}`);
  check("an unknown address is reported as NOT sent",
    ghost.body?.data?.sent === false && ghost.body?.data?.maskedEmail === "",
    JSON.stringify(ghost.body?.data));
  check("a known address is reported as sent, with a masked destination",
    known.body?.data?.sent === true
      && typeof known.body?.data?.maskedEmail === "string"
      && known.body.data.maskedEmail.length > 0,
    JSON.stringify(known.body?.data));
  // The whole point of masking: enough to recognise the inbox, not a second
  // copy of the address sitting in a public log.
  check("the reply never contains the full address",
    !JSON.stringify(known.body).includes(forgotEmail),
    JSON.stringify(known.body));
  check("nor any unmasked local part",
    !JSON.stringify(known.body).includes(forgotEmail.split("@")[0]),
    JSON.stringify(known.body));

  const resetCode = lastCodeFor(forgotEmail);
  check("case A: a 6-digit code was emailed", Boolean(resetCode),
    "no code found in the outbox");

  // The two flows are deliberately NOT interchangeable. `set-password/request`
  // refuses to issue a code for an account that ALREADY has a password — that
  // is the guard against "claiming" a working account — so asking for one here
  // must send nothing at all. If it did send, the reset code below would be
  // shadowed and the cross-purpose test would silently stop testing anything.
  const beforeSetup = readOutbox().filter((m) => m.to === forgotEmail).length;
  r = await call(anon(), "POST", "/api/auth/set-password/request", {
    email: forgotEmail,
  });
  check("a setup request for an account that has a password is silently ignored",
    r.status === 200, `got ${r.status}`);
  check("and it sends no new email at all",
    readOutbox().filter((m) => m.to === forgotEmail).length === beforeSetup,
    "a setup code was emailed to an account that already has one");

  const liveCode = lastCodeFor(forgotEmail);

  // ── The reset itself ──────────────────────────────────────────────────
  const resetter = anon();
  r = await call(resetter, "POST", "/api/auth/forgot-password/confirm", {
    identifier: forgotEmail, code: liveCode, password: "BrandNew456",
  });
  check("case A: the code resets the password (200)", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body)}`);
  check("the account reports that it now has a password",
    r.body?.data?.user?.hasPassword === true,
    JSON.stringify(r.body?.data?.user));

  // ── Property 3: old dead, new alive ───────────────────────────────────
  r = await call(anon(), "POST", "/api/auth/login", {
    identifier: forgotEmail, password: "Original123",
  });
  check("the OLD password no longer works", r.status === 401,
    `got ${r.status}`);

  r = await call(anon(), "POST", "/api/auth/login", {
    identifier: forgotEmail, password: "BrandNew456",
  });
  check("the NEW password works", r.status === 200, `got ${r.status}`);

  // ── Property 4: every OTHER session is revoked ────────────────────────
  r = await call(otherDevice, "GET", "/api/auth/me");
  check("case A: the other device's session was revoked by the reset",
    r.status === 401, `got ${r.status}`);

  r = await call(resetter, "GET", "/api/auth/me");
  check("case A: the resetting browser is signed in",
    r.status === 200, `got ${r.status}`);

  // The stored hash really changed, and no plaintext leaked.
  const afterA = await userModel.findOne({ email: forgotEmail })
    .select("+passwordHash").lean();
  check("the stored hash is different from the original",
    afterA?.passwordHash && afterA.passwordHash !== originalHash);
  check("the new hash never appears in any response",
    !JSON.stringify(r.body).includes("$2"));

  await mongoose.disconnect();
}

/**
 * CASE B, in its own function because it needs a genuinely password-less
 * account — the situation "never had a password" actually describes.
 *
 * It also owns the CROSS-PURPOSE test, which is only meaningful here: an
 * account with no password can have BOTH a `set_password` code and a
 * `reset_password` code minted for it, so each can be tried against the wrong
 * endpoint. (In case A no `set_password` code can be minted at all — that flow
 * refuses to touch an account that already works.)
 */
export async function phase19PasswordSet(ctx) {
  section("Phase 19b — forgot password on an account that has none");

  await mongoose.connect(ctx.uri, { serverSelectionTimeoutMS: 15_000 });
  const anon = () => new Session();

  // Its OWN account, created directly rather than reusing phase 17's: that one
  // has since CLAIMED a password, so it no longer represents this case.
  // `passwordHash: null` is the exact state an operator-created account has.
  //
  // Written with the RAW driver, so `timestamps` does NOT apply and both date
  // fields are set by hand — `toPublicUser` reads `createdAt.toISOString()`,
  // and a row without it 500s. That is a property of this test's shortcut, not
  // of the app: every real write goes through Mongoose and always stamps them.
  const email = "never-had-one@fastauth.test";
  const now = new Date();
  await mongoose.connection.collection("users").updateOne(
    { email },
    {
      $set: {
        name: "Nina NoPassword", email, username: "neverhadone",
        passwordHash: null, authSource: "platform",
        emailVerified: true, emailVerifiedAt: now,
        createdAt: now, updatedAt: now,
      },
    },
    { upsert: true },
  );

  const before = await mongoose.connection
    .collection("users").findOne({ email }, { projection: { passwordHash: 1 } });
  check("case B: the account starts with no password",
    before && (before.passwordHash ?? null) === null,
    JSON.stringify(before));

  // ── Property 5: the purposes are not interchangeable ───────────────────
  // Mint a `set_password` code for this account (it has none, so this flow
  // applies), then try to spend it on the RESET endpoint. The purpose is mixed
  // into the stored hash, so it must be refused even though the digits are
  // live, correct and belong to this very account.
  let r = await call(anon(), "POST", "/api/auth/set-password/request", { email });
  check("case B: a setup code can be requested for it", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body)}`);
  const setupCode = lastCodeFor(email);
  check("case B: the setup code was emailed", Boolean(setupCode), "no code");

  const crossReset = await call(anon(), "POST", "/api/auth/forgot-password/confirm", {
    identifier: email, code: setupCode, password: "CrossPurpose123",
  });
  check("a set_password code CANNOT be spent on the reset endpoint",
    crossReset.status === 400 &&
      crossReset.body?.error === "INVALID_VERIFICATION_CODE",
    `got ${crossReset.status} ${crossReset.body?.error}`);

  // Now the mirror image: a reset code must not unlock the SET endpoint.
  r = await call(anon(), "POST", "/api/auth/forgot-password", { identifier: email });
  check("case B: a reset code is requested for it too", r.status === 200,
    `got ${r.status}`);
  const resetCode = lastCodeFor(email);

  const crossSet = await call(anon(), "POST", "/api/auth/set-password/confirm", {
    email, code: resetCode, password: "CrossPurpose456",
  });
  check("a reset_password code CANNOT be spent on the set-password endpoint",
    crossSet.status === 400 &&
      crossSet.body?.error === "INVALID_VERIFICATION_CODE",
    `got ${crossSet.status} ${crossSet.body?.error}`);

  // Neither cross-use may have written a password.
  const untouched = await mongoose.connection
    .collection("users").findOne({ email }, { projection: { passwordHash: 1 } });
  check("neither cross-purpose attempt wrote a password",
    (untouched?.passwordHash ?? null) === null, JSON.stringify(untouched));

  // ── Property 2: the reset writes the FIRST password ───────────────────
  r = await call(anon(), "POST", "/api/auth/forgot-password/confirm", {
    identifier: email, code: resetCode, password: "FirstTime789",
  });
  check("case B: the same flow writes its FIRST password", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body)}`);

  r = await call(anon(), "POST", "/api/auth/login", {
    identifier: email, password: "FirstTime789",
  });
  check("case B: it can now sign in with that password", r.status === 200,
    `got ${r.status}`);

  // And it is genuinely a password now — not still NULL.
  const after = await mongoose.connection
    .collection("users").findOne({ email }, { projection: { passwordHash: 1 } });
  check("case B: a hash is now stored",
    typeof after?.passwordHash === "string" && after.passwordHash.length > 0);

  const username = "neverhadone";
  // The screen is three steps now: which account, is the code right, choose a
  // password. A person who cannot sign in is exactly the person who does not
  // remember whether they signed up with an email or a username, so both have
  // to work — and the middle step must be a real server check, not merely
  // "six boxes filled in".
  r = await call(anon(), "POST", "/api/auth/forgot-password", {
    identifier: username,
  });
  check("a reset can be requested by USERNAME, not only by email",
    r.status === 200 && r.body?.data?.sent === true
      && typeof r.body?.data?.maskedEmail === "string",
    `got ${r.status} ${JSON.stringify(r.body?.data)}`);

  const byUsername = lastCodeFor(email);
  check("the code still went to the real address, not to the username",
    typeof byUsername === "string" && byUsername.length === 6,
    `got ${byUsername}`);

  // Wrong code: refused, and it must not open the password step.
  r = await call(anon(), "POST", "/api/auth/forgot-password/verify", {
    identifier: username, code: "000000",
  });
  check("a wrong code is refused by the verify step",
    r.status === 400 && r.body?.error === "INVALID_VERIFICATION_CODE",
    `got ${r.status} ${r.body?.error}`);

  // A wrong guess must cost an attempt. One guess is not enough to prove it —
  // the budget is five, and the point is that all five are spent HERE, on the
  // verify step, rather than being saved up for the real one.
  let wrongGuessRefused = 0;
  for (let i = 0; i < 6; i += 1) {
    const guess = await call(anon(), "POST", "/api/auth/forgot-password/verify", {
      identifier: username, code: `00000${i % 10}`,
    });
    if (guess.status !== 200) wrongGuessRefused += 1;
  }
  check("the verify step counts wrong guesses instead of ignoring them",
    wrongGuessRefused >= 5,
    `only ${wrongGuessRefused}/6 wrong guesses were refused — the attempt budget is not being spent here`);

  // And the budget, once spent, really does destroy the code.
  r = await call(anon(), "POST", "/api/auth/forgot-password/verify", {
    identifier: username, code: byUsername,
  });
  check("an exhausted budget burns the code even when the right one is typed",
    r.status === 429 || r.status === 400,
    `got ${r.status} ${r.body?.error}`);

  // Re-request to get a fresh, unspent code, then prove verify does NOT spend it.
  r = await call(anon(), "POST", "/api/auth/forgot-password", {
    identifier: username,
  });
  check("a fresh code can be requested", r.status === 200, `got ${r.status}`);
  const freshCode = lastCodeFor(email);

  r = await call(anon(), "POST", "/api/auth/forgot-password/verify", {
    identifier: username, code: freshCode,
  });
  check("the right code passes the verify step", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body)}`);
  check("and it confirms the masked destination again",
    r.body?.data?.valid === true && typeof r.body?.data?.maskedEmail === "string",
    JSON.stringify(r.body?.data));

  // Verify must not have consumed it — the password step still needs it.
  r = await call(anon(), "POST", "/api/auth/forgot-password/verify", {
    identifier: username, code: freshCode,
  });
  check("verify does NOT spend the code, so the same code still passes",
    r.status === 200, `got ${r.status} ${r.body?.error}`);

  const outboxBefore = readOutbox().length;
  // ONE session across both calls — a new `Session` here would not carry the
  // cookie the confirm call just set, and the check below would prove nothing.
  const resettingBrowser = anon();
  r = await call(resettingBrowser, "POST", "/api/auth/forgot-password/confirm", {
    identifier: username, code: freshCode, password: "Renamed123",
  });
  check("the reset completes using the USERNAME, not the email", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body)}`);

  // Auto-login: the confirm call itself must have opened a session.
  const signedIn = await call(resettingBrowser, "GET", "/api/auth/me");
  check("the reset signed the browser in without a second sign-in",
    signedIn.status === 200, `got ${signedIn.status}`);

  // The security notice. Without one, a hijacked mailbox is invisible to the
  // real owner, so this is the whole point of emailing on success.
  const outboxAfter = readOutbox();
  const notice = outboxAfter
    .slice(outboxBefore)
    .find((m) => m.to === email && /password was changed/i.test(m.subject ?? ""));
  check("a 'password changed' notice is emailed to the owner", Boolean(notice),
    JSON.stringify(outboxAfter.slice(outboxBefore).map((m) => m.subject)));

  await mongoose.disconnect();
}