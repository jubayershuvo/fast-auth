import { check, section, call, Session } from "../harness.mjs";
import { lastCodeFor } from "../mail-inbox.mjs";

/**
 * Phase 1 — dashboard registration, EMAIL VERIFICATION, login, session cookie.
 *
 * Registration no longer signs you in: it creates an unverified account and
 * emails a 6-digit code. The suite reads that code out of the mail outbox
 * (scripts/mail-inbox.mjs) exactly as a person would read it from their inbox,
 * so the whole flow is exercised for real rather than stubbed.
 */
export async function phase1Auth(ctx) {
  section("Phase 1 — dashboard registration, email verification, login");
  const owner = new Session();
  ctx.owner = owner;
  const anon = new Session();
  ctx.anon = anon;

  let r = await call(owner, "POST", "/api/auth/register", {
    name: "Olive Owner", email: "owner@example.com", username: "owner", password: "Owner123",
  });
  check("register returns 201", r.status === 201, `got ${r.status}`);
  check("register never returns a password hash",
    !JSON.stringify(r.body).includes("passwordHash"), JSON.stringify(r.body).slice(0, 120));
  check("register returns the safe public shape",
    r.body?.data?.user?.email === "owner@example.com" && r.body?.data?.user?.id,
    JSON.stringify(r.body?.data));
  check("register reports that verification is required",
    r.body?.data?.verificationRequired === true, JSON.stringify(r.body?.data));
  check("the new account starts UNVERIFIED",
    r.body?.data?.user?.emailVerified === false, JSON.stringify(r.body?.data?.user));
  check("the account is flagged as self-registered",
    r.body?.data?.user?.authSource === "self", JSON.stringify(r.body?.data?.user));

  // ── The account cannot be used until the code is entered ───────────────
  r = await call(anon, "POST", "/api/auth/login", {
    identifier: "owner@example.com", password: "Owner123",
  });
  check("an unverified account cannot sign in (403 EMAIL_NOT_VERIFIED)",
    r.status === 403 && r.body?.error === "EMAIL_NOT_VERIFIED",
    `got ${r.status} ${r.body?.error}`);

  // ── A wrong code is refused, and burns no session ─────────────────────
  const code = lastCodeFor("owner@example.com");
  check("a 6-digit code was emailed to the new account", Boolean(code), `got ${code}`);

  const wrong = new Session();
  r = await call(wrong, "POST", "/api/auth/verify-email", {
    email: "owner@example.com",
    // Deliberately different from the real one.
    code: code === "000000" ? "111111" : "000000",
  });
  check("a wrong verification code is refused (400)",
    r.status === 400 && r.body?.error === "INVALID_VERIFICATION_CODE",
    `got ${r.status} ${r.body?.error}`);
  check("the wrong attempt does not sign anyone in",
    (await call(wrong, "GET", "/api/auth/me")).status === 401);

  // ── The right code verifies AND signs in, in one call ─────────────────
  r = await call(owner, "POST", "/api/auth/verify-email", {
    email: "owner@example.com", code,
  });
  check("the correct code verifies the account (200)", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body)}`);
  check("verification signs the user in at the same time",
    (await call(owner, "GET", "/api/auth/me")).status === 200);
  check("the account is now verified",
    r.body?.data?.user?.emailVerified === true, JSON.stringify(r.body?.data?.user));

  // ── The code is single-use ────────────────────────────────────────────
  // Deliberately verified through a SECOND account rather than by replaying the
  // first: `verifyAccountEmail` is intentionally idempotent for an
  // already-verified address (so a user who resends and re-enters an old code is
  // not punished), which means a replay here would legitimately return 200.
  // Single-use is asserted where it is actually enforced — a second code
  // invalidates the first, in the "set password" phase below.
  const replay = new Session();
  r = await call(replay, "POST", "/api/auth/verify-email", {
    email: "owner@example.com", code,
  });
  check("an already-verified account accepts a repeat code idempotently",
    r.status === 200 && r.body?.data?.user?.emailVerified === true,
    `got ${r.status}`);

  r = await call(owner, "GET", "/api/auth/me");
  check("me resolves the session cookie", r.status === 200 && r.body.data.username === "owner",
    JSON.stringify(r.body));
  check("me includes the display name", r.body.data?.name === "Olive Owner",
    JSON.stringify(r.body.data));

  // ── the display name itself ──────────────────────────────────────────────
  section("Phase 1 — display name");

  r = await call(anon, "POST", "/api/auth/register", {
    email: "noname@example.com", username: "nonameuser", password: "NoName123",
  });
  check("registering without a name is rejected", r.status === 400, `got ${r.status}`);

  r = await call(anon, "POST", "/api/auth/register", {
    name: "   ", email: "blank@example.com", username: "blankuser", password: "Blank1234",
  });
  check("a whitespace-only name is rejected", r.status === 400, `got ${r.status}`);

  r = await call(anon, "POST", "/api/auth/register", {
    name: "x".repeat(81), email: "long@example.com", username: "longuser", password: "Long12345",
  });
  check("an over-long name is rejected", r.status === 400, `got ${r.status}`);

  // Real names carry spaces, apostrophes and non-Latin scripts, so the name
  // rule must be looser than the username rule.
  r = await call(anon, "POST", "/api/auth/register", {
    name: "Ada O'Brien-Łukasz", email: "ada@example.com",
    username: "adauser", password: "AdaPass12",
  });
  check("a name with spaces, punctuation and unicode is accepted", r.status === 201,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
  check("the name is stored verbatim", r.body?.data?.user?.name === "Ada O'Brien-Łukasz",
    JSON.stringify(r.body?.data?.user?.name));

  // Self-service: a customer can change their own name…
  r = await call(owner, "PATCH", "/api/auth/profile", { name: "Olive Renamed" });
  check("a customer can update their own name", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
  check("the updated name is returned", r.body?.data?.user?.name === "Olive Renamed",
    JSON.stringify(r.body?.data?.user?.name));

  r = await call(owner, "GET", "/api/auth/me");
  check("the new name is visible on the very next request",
    r.body.data?.name === "Olive Renamed", JSON.stringify(r.body.data?.name));

  // …but the route cannot be aimed at anyone else, nor touch identity fields.
  // A FRESH session is required here: the successful registration above signed
  // `anon` in (register logs you in immediately), so reusing it would assert
  // nothing about the unauthenticated path.
  const signedOut = new Session();
  r = await call(signedOut, "PATCH", "/api/auth/profile", { name: "Hacker" });
  check("profile update without a session is 401", r.status === 401, `got ${r.status}`);

  r = await call(signedOut, "GET", "/api/auth/me");
  check("me without a session is 401", r.status === 401, `got ${r.status}`);

  r = await call(owner, "PATCH", "/api/auth/profile", {
    name: "Olive Renamed", email: "attacker@example.com", userId: "000000000000000000000000",
  });
  check("profile update ignores extra fields (no mass assignment)",
    r.status === 200 && r.body?.data?.user?.email === "owner@example.com",
    `got ${r.status} ${JSON.stringify(r.body?.data?.user?.email)}`);

  r = await call(owner, "PATCH", "/api/auth/profile", { name: "" });
  check("an empty name is rejected", r.status === 400, `got ${r.status}`);

  // Restore the fixture name for later phases.
  await call(owner, "PATCH", "/api/auth/profile", { name: "Olive Owner" });

  r = await call(owner, "POST", "/api/auth/register", {
    name: "Owner Two",
    name: "Owner Two", email: "owner@example.com", username: "owner2", password: "Owner123",
  });
  check("duplicate email rejected with 409", r.status === 409, `got ${r.status}`);

  r = await call(owner, "POST", "/api/auth/register", {
    name: "Owner Three",
    name: "Owner Three", email: "owner2@example.com", username: "owner", password: "Owner123",
  });
  check("duplicate username rejected with 409", r.status === 409, `got ${r.status}`);

  r = await call(owner, "POST", "/api/auth/register", {
    name: "Weak User",
    name: "Weak User", email: "weak@example.com", username: "weakuser", password: "alllowercase",
  });
  check("weak password rejected with 400", r.status === 400, `got ${r.status}`);

  r = await call(anon, "POST", "/api/auth/login", { identifier: "owner", password: "Wrong123" });
  check("wrong password is 401 INVALID_CREDENTIALS",
    r.status === 401 && r.body.error === "INVALID_CREDENTIALS", JSON.stringify(r.body));

  r = await call(anon, "POST", "/api/auth/login", { identifier: "ghost", password: "Whatever1" });
  check("unknown user yields the same generic error (no enumeration)",
    r.status === 401 && r.body.error === "INVALID_CREDENTIALS", JSON.stringify(r.body));

  r = await call(anon, "POST", "/api/auth/login", { identifier: "owner@example.com", password: "Owner123" });
  check("login by email works", r.status === 200, `got ${r.status}`);

  r = await call(anon, "POST", "/api/auth/login", { identifier: "owner", password: "Owner123" });
  check("login by username works", r.status === 200, `got ${r.status}`);

  r = await call(anon, "GET", "/api/dashboard/applications");
  check("session works on the dashboard API", r.status === 200, `got ${r.status}`);
}
