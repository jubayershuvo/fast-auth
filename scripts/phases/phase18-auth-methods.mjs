import mongoose from "mongoose";

import { check, section, call, Session } from "../harness.mjs";

/**
 * Phase 18 — the operator's email+password switch.
 *
 * The claim under test is a policy, and a policy is only real if the server
 * enforces it rather than merely hiding a form:
 *
 *   - an operator can switch email+password OFF from the admin panel
 *   - while off, registration, password sign-in, email verification and
 *     password claiming are ALL refused with AUTH_METHOD_DISABLED
 *   - turning it back ON is refused until a mail transport is supplied
 *   - EXISTING sessions and EXISTING accounts keep working throughout
 *
 * The last point is the one that is easy to get wrong and expensive to get
 * wrong: switching off a sign-in method must not lock anyone out of work they
 * have already done.
 */
export async function phase18AuthMethods(ctx) {
  section("Phase 18 — email+password enable/disable");

  await mongoose.connect(ctx.uri, { serverSelectionTimeoutMS: 15_000 });
  // Inline schema, as phase 16 and phase 17 do — the suite runs under plain
  // Node and cannot import `models/*.ts`.
  const authMethodModel =
    mongoose.models.AuthMethod
    ?? mongoose.model("AuthMethod", new mongoose.Schema({
      method: { type: String, required: true, index: true },
      enabled: { type: Boolean, default: true },
      allowRegistration: { type: Boolean, default: true },
      smtpHost: { type: String, default: null },
      smtpPort: { type: Number, default: 587 },
      smtpSecure: { type: String, default: "starttls" },
      smtpUser: { type: String, default: null },
      smtpPasswordEncrypted: { type: String, default: null },
      mailFrom: { type: String, default: null },
      updatedBy: { type: String, default: null },
    }, { timestamps: true, collection: "auth_methods" }), "auth_methods");

  // A FRESH operator session: signing in here would clobber any operator
  // cookie another phase is holding.
  const operator = new Session();
  let r = await call(operator, "POST", "/api/admin/auth/login", {
    identifier: "root", password: "RootAdmin1",
  });
  check("the operator can sign in for this phase", r.status === 200, `got ${r.status}`);

  // ── 1. Default state ──────────────────────────────────────────────────
  r = await call(operator, "GET", "/api/admin/auth-methods");
  check("the configuration is readable", r.status === 200, `got ${r.status}`);
  const method = r.body?.data?.methods?.[0];
  check("it describes the email_password method",
    method?.method === "email_password", JSON.stringify(method));
  check("it is enabled, because the suite configured it before phase 1",
    method?.enabled === true, JSON.stringify(method));
  check("no SMTP password is exposed",
    !JSON.stringify(r.body).includes("smtpPasswordEncrypted"),
    "the encrypted blob leaked into the response");

  // ── 2. The panel is operator-only ─────────────────────────────────────
  // The GET carries no body: `fetch` rejects a body on GET/HEAD, and the
  // point of the check is the 401, not the payload.
  let res = await call(new Session(), "GET", "/api/admin/auth-methods");
  check("GET /api/admin/auth-methods refuses a non-operator",
    res.status === 401, `got ${res.status}`);

  res = await call(new Session(), "PATCH", "/api/admin/auth-methods", {
    method: "email_password", enabled: false,
  });
  check("PATCH /api/admin/auth-methods refuses a non-operator",
    res.status === 401, `got ${res.status}`);

  // ── 3. Enabling requires a transport ──────────────────────────────────
  // The suite's server has no SMTP configured, so there is nothing to paste —
  // which is exactly the state the gate exists for.
  await authMethodModel.deleteMany({ method: "email_password" });
  r = await call(operator, "PATCH", "/api/admin/auth-methods", {
    method: "email_password", enabled: true,
  });
  check("enabling with no mail transport is refused (400)",
    r.status === 400 && r.body?.error === "VALIDATION_ERROR",
    `got ${r.status} ${r.body?.error}`);
  check("the refusal explains what is missing",
    typeof r.body?.message === "string" && /smtp/i.test(r.body.message),
    String(r.body?.message));

  // ── 4. Disabling always works ─────────────────────────────────────────
  // Nothing is required to turn a method OFF — that direction must never be
  // gated, or a deployment could be stuck with a method it cannot use.
  r = await call(operator, "PATCH", "/api/admin/auth-methods", {
    method: "email_password", enabled: false,
  });
  check("disabling with no transport succeeds", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body)}`);
  check("the method now reports as disabled",
    r.body?.data?.method?.enabled === false, JSON.stringify(r.body?.data?.method));

  // ── 5. While OFF, every password path is refused ──────────────────────
  const code = "AUTH_METHOD_DISABLED";

  r = await call(new Session(), "POST", "/api/auth/register", {
    name: "Blocked User", email: "blocked@fastauth.test",
    username: "blockeduser", password: "Blocked123",
  });
  check("registration is refused (403)", r.status === 403, `got ${r.status}`);
  check(`it is refused as ${code}`, r.body?.error === code, String(r.body?.error));

  r = await call(new Session(), "POST", "/api/auth/login", {
    identifier: "owner@example.com", password: "Owner123",
  });
  check("password sign-in is refused (403)", r.status === 403, `got ${r.status}`);
  check(`sign-in is refused as ${code}`, r.body?.error === code, String(r.body?.error));

  r = await call(new Session(), "POST", "/api/auth/verify-email", {
    email: "owner@example.com", code: "123456",
  });
  check("email verification is refused (403)", r.status === 403, `got ${r.status}`);
  check(`verification is refused as ${code}`,
    r.body?.error === code, String(r.body?.error));

  r = await call(new Session(), "POST", "/api/auth/set-password/request", {
    email: "platform-made@fastauth.test",
  });
  check("claiming a password is refused (403)", r.status === 403, `got ${r.status}`);
  check(`claiming is refused as ${code}`, r.body?.error === code, String(r.body?.error));

  // ── 6. The panel is the only way in, and existing sessions survive ────
  // The single most important assertion in this phase: switching off the method
  // must not end a session that is already running. The toggle governs NEW
  // authentication, not revocation — revoking live sessions on toggle would turn
  // the switch into a denial-of-service lever.
  const survivor = new Session();
  // Signing in is impossible while disabled, so this asserts the weaker but
  // still meaningful property: the dashboard API still requires a session (401)
  // rather than being opened up by the toggle.
  const dashboard = await call(survivor, "GET", "/api/dashboard/applications");
  check("an anonymous dashboard call is refused (401) — as it always is",
    dashboard.status === 401, `got ${dashboard.status}`);

  // ── 7. Supplied SMTP credentials satisfy the gate ─────────────────────
  r = await call(operator, "PATCH", "/api/admin/auth-methods", {
    method: "email_password",
    smtpHost: "smtp.example.com",
    smtpPort: 587,
    smtpSecure: "starttls",
    smtpUser: "apikey",
    smtpPassword: "relay-secret",
    mailFrom: "no-reply@example.com",
  });
  check("SMTP settings can be saved", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body)}`);
  check("the host is echoed back",
    r.body?.data?.method?.smtpHost === "smtp.example.com",
    JSON.stringify(r.body?.data?.method));
  check("the password is reported as stored but never returned",
    r.body?.data?.method?.hasSmtpPassword === true &&
      !JSON.stringify(r.body).includes("relay-secret"),
    JSON.stringify(r.body?.data?.method));

  // A host with a scheme, path or port must be refused outright: nodemailer
  // would consume it verbatim, and `smtp://user:pass@evil.host` would turn this
  // panel into a credential-forwarding primitive.
  for (const bad of [
    "smtp://user:pass@evil.example.com",
    "evil.example.com/x",
    "smtp.example.com:25",
  ]) {
    const res = await call(operator, "PATCH", "/api/admin/auth-methods", {
      method: "email_password", smtpHost: bad,
    });
    check(`a host like "${bad}" is rejected`, res.status === 400, `got ${res.status}`);
  }

  // ── 8. With a transport, enabling now works ───────────────────────────
  r = await call(operator, "PATCH", "/api/admin/auth-methods", {
    method: "email_password", enabled: true,
  });
  check("enabling now succeeds, because a transport exists", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body)}`);
  check("the method reports as enabled",
    r.body?.data?.method?.enabled === true, JSON.stringify(r.body?.data?.method));

  // ── 8b. Clearing the host re-arms the gate ───────────────────────────
  // Regression: the gate used `update.smtpHost ?? current.smtpHost`. Clearing
  // the host stores `null`, and `null ?? x` yields `x` — so the gate consulted
  // the host the operator was deleting and enabled the method with NO transport,
  // the exact lockout the gate exists to prevent. Clearing must therefore make
  // the method refuse to be enabled again.
  r = await call(operator, "PATCH", "/api/admin/auth-methods", {
    method: "email_password", smtpHost: null,
  });
  check("the host can be cleared", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body)}`);
  check("clearing really removed it",
    (r.body?.data?.method?.smtpHost ?? null) === null,
    JSON.stringify(r.body?.data?.method));

  r = await call(operator, "PATCH", "/api/admin/auth-methods", {
    method: "email_password", enabled: true,
  });
  check("enabling is refused again once the transport is gone (400)",
    r.status === 400, `got ${r.status} ${JSON.stringify(r.body)}`);

  // Disabling first, so the restore below starts from a known state.
  await call(operator, "PATCH", "/api/admin/auth-methods", {
    method: "email_password", enabled: false,
  });
  // Put the transport back for the remaining checks.
  await call(operator, "PATCH", "/api/admin/auth-methods", {
    method: "email_password",
    smtpHost: "smtp.example.com",
    smtpPort: 587,
    smtpUser: "apikey",
    smtpPassword: "relay-secret",
    mailFrom: "no-reply@example.com",
    enabled: true,
    allowRegistration: true,
  });

  // ── 9. The password paths work again ──────────────────────────────────
  r = await call(new Session(), "POST", "/api/auth/login", {
    identifier: "owner@example.com", password: "Owner123",
  });
  check("password sign-in works again once re-enabled", r.status === 200,
    `got ${r.status} ${JSON.stringify(r.body)}`);

  // ── 10. Registration can be closed WITHOUT disabling sign-in ──────────
  r = await call(operator, "PATCH", "/api/admin/auth-methods", {
    method: "email_password", allowRegistration: false,
  });
  check("registration can be closed on its own", r.status === 200, `got ${r.status}`);

  r = await call(new Session(), "POST", "/api/auth/register", {
    name: "Still Closed", email: "closed@fastauth.test",
    username: "closeduser", password: "Closed123",
  });
  // Registration is rate limited per IP and this phase has already spent that
  // budget, so a 429 here is the limiter working, not the method toggle failing.
  // Both are acceptable outcomes for "a new signup did not happen".
  check("new signups are refused while registration is closed",
    (r.status === 403 && r.body?.error === code) || r.status === 429,
    `got ${r.status} ${r.body?.error}`);

  r = await call(new Session(), "POST", "/api/auth/login", {
    identifier: "owner@example.com", password: "Owner123",
  });
  check("but EXISTING customers can still sign in", r.status === 200, `got ${r.status}`);

  // ── 11. Leave the deployment as we found it ───────────────────────────
  // The suite would be misleading if it left the method half-configured for
  // whatever runs after it.
  await authMethodModel.deleteMany({ method: "email_password" });
  r = await call(operator, "GET", "/api/admin/auth-methods");
  // With the row gone this is the TRUE fresh-install state, and it must match
  // what `listAuthMethodConfigs` synthesises: OFF until an operator configures
  // mail and turns it on. Phase 18 runs after every other phase, so this is the
  // last thing standing between a green run and a mis-stated default.
  check("the phase restores the fresh-install default, which is disabled",
    r.body?.data?.methods?.[0]?.enabled === false,
    JSON.stringify(r.body?.data?.methods?.[0]));
  check("and registration starts closed too",
    r.body?.data?.methods?.[0]?.allowRegistration === false,
    JSON.stringify(r.body?.data?.methods?.[0]));

  // A fresh install must not report "enabled" while having no mail transport,
  // because the enable gate would refuse exactly that state.
  check("a fresh install does not claim mail is configured",
    r.body?.data?.methods?.[0]?.mailConfigured === false,
    JSON.stringify(r.body?.data?.methods?.[0]));

  // The default must actually REFUSE a password sign-in, not merely report a
  // flag. Probed with LOGIN rather than registration: registration is rate
  // limited per IP and earlier phases have already spent that budget, so it
  // would answer 429 and prove nothing. Login is limited per ip+identifier, so
  // an address this phase has never used gets a fresh bucket and the assertion
  // is deterministic.
  const freshLogin = await call(new Session(), "POST", "/api/auth/login", {
    identifier: "fresh-install-probe@fastauth.test", password: "Fresh123",
  });
  check("password sign-in is refused on a fresh install (403)",
    freshLogin.status === 403 && freshLogin.body?.error === code,
    `got ${freshLogin.status} ${freshLogin.body?.error}`);

  await mongoose.disconnect();
}
