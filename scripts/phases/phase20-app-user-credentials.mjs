import { check, section, call } from "../harness.mjs";

/**
 * Phase 20 — app-user credentials are the CUSTOMER's business.
 *
 * An end user belongs to the customer's own product, so the format of its
 * username and password is theirs to decide: a Steam ID, an email, a UUID, an
 * opaque token, a one-character PIN. The dashboard's `[a-z0-9_.-]{3,32}` and
 * "8+ chars, mixed case and a number" rules are NOT applied to this realm, and
 * this phase proves it end to end rather than asserting it in a comment.
 *
 * It also pins the three guards that were deliberately KEPT, because relaxing
 * "the validation" must not quietly remove a security property:
 *
 *   - both values must be non-empty (an empty handle is not a credential)
 *   - control characters are stripped from the username (audit-log integrity)
 *   - the password is still capped at bcrypt's 72 BYTES, or two passwords
 *     sharing a 72-byte prefix would authenticate interchangeably
 *
 * The dashboard realm is asserted to be UNCHANGED, so this cannot be mistaken
 * for a global loosening.
 */
export async function phase20AppUserCredentials(ctx) {
  section("Phase 20 — app-user credentials are unconstrained");
  const { owner, app } = ctx;
  const base = `/api/dashboard/applications/${app.id}/users`;

  // ── 1. Credentials the dashboard would reject ────────────────────────
  const wild = [
    { label: "a one-character username", username: "x" },
    { label: "a single-character password", password: "x" },
    { label: "an all-lowercase password", password: "alllowercase" },
    { label: "a purely numeric password", password: "123456" },
    { label: "an email address as the username", username: "player@example.com" },
    { label: "a UUID as the username", username: "550e8400-e29b-41d4-a716-446655440000" },
    { label: "a space and an @ in the username", username: "Player One@Host" },
    { label: "a non-Latin script username", username: "プレイヤー太郎" },
    { label: "an emoji username", username: "player🎮" },
    { label: "an opaque 60-char token username", username: "f".repeat(60) },
    { label: "a password with symbols only", password: "!@#$%^&*()-_=+" },
  ];

  let created = 0;
  let n = 0;
  for (const spec of wild) {
    // Each spec needs a DISTINCT handle: three of them vary only the password,
    // and reusing one username would make the second a 409 duplicate and look
    // like a rejection of the permissive rule.
    n += 1;
    const body = {
      name: `Wild Card ${n}`,
      username: spec.username ?? `wildcard-player-${n}`,
      password: spec.password ?? "wildcard-pass",
      ...spec,
    };
    const r = await call(owner, "POST", base, body);
    const ok = r.status === 201;
    if (ok) created += 1;
    check(`${spec.label} is accepted`, ok,
      `got ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  }
  check("every unconstrained form was accepted", created === wild.length,
    `${created}/${wild.length}`);

  // ── 2. The guards that were kept ──────────────────────────────────────
  for (const [label, body] of [
    ["an empty username", { username: "" }],
    ["a whitespace-only username", { username: "   " }],
    ["an empty password", { password: "" }],
    ["a whitespace-only password", { password: "   " }],
  ]) {
    const r = await call(owner, "POST", base, {
      name: "Guard Test", username: "guard-player", password: "guard-pass", ...body,
    });
    check(`${label} is still rejected`, r.status === 400,
      `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  }

  // bcrypt truncates at 72 BYTES. Without a matching cap, two passwords sharing
  // their first 72 bytes would hash identically — an authentication bypass.
  let r = await call(owner, "POST", base, {
    name: "Too Long", username: "toolong-player", password: "a".repeat(73),
  });
  check("a 73-byte password is rejected (bcrypt's hard limit)", r.status === 400,
    `got ${r.status}`);

  // Exactly at the limit must still work — otherwise the cap is off by one.
  r = await call(owner, "POST", base, {
    name: "Exactly 72", username: "exact72-player", password: "b".repeat(72),
  });
  check("a 72-byte password is accepted", r.status === 201,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

  // The cap counts BYTES, not characters: 30 emoji are 120 bytes.
  r = await call(owner, "POST", base, {
    name: "Emoji Pass", username: "emoji-pass-player", password: "🎮".repeat(30),
  });
  check("a multi-byte password over 72 BYTES is rejected", r.status === 400,
    `got ${r.status}`);

  // ── 3. Normalisation, not restriction ─────────────────────────────────
  // Case is folded so sign-in agrees with the (applicationId, username) index.
  // This proves it is folding rather than rejection.
  r = await call(owner, "POST", base, {
    name: "Case Fold", username: "CaseFoldPlayer", password: "any",
  });
  check("a mixed-case username is accepted", r.status === 201,
    `got ${r.status}`);
  check("and is stored lowercased",
    r.body?.data?.username === "casefoldplayer",
    JSON.stringify(r.body?.data?.username));

  r = await call(owner, "POST", base, {
    name: "Case Fold", username: "casefoldPLAYER", password: "any",
  });
  check("the same username in different case is a duplicate, not a second user",
    r.status === 409, `got ${r.status}`);

  // Control characters are stripped, not rejected, so the stored handle can
  // never carry a newline into the audit log.
  r = await call(owner, "POST", base, {
    name: "Newline", username: "evil\r\nFAKE-LOG-LINE", password: "any",
  });
  check("control characters are stripped from the username", r.status === 201,
    `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  check("the stored handle carries no newline",
    typeof r.body?.data?.username === "string" &&
      !/[\r\n]/.test(r.body.data.username),
    JSON.stringify(r.body?.data?.username));

  // ── 4. The whole point: such an account can actually SIGN IN ──────────
  // A permissive rule that produces an unusable account is not a feature.
  // Created explicitly as a unicode handle with a ONE-CHARACTER password, since
  // both halves of that claim have to hold at once. A different script from
  // the one in the list above, so this is a new account rather than a 409.
  const unicode = "ΛογισμικόΠαίκτης";
  r = await call(owner, "POST", base, {
    name: "Wild Login", username: unicode, password: "1",
  });
  check("a unicode username with a 1-char password can be created",
    r.status === 201, `got ${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);

  // The app id travels in the `X-App-Id` header, per the v1 contract.
  r = await call(null, "POST", "/api/v1/auth/login", {
    username: unicode,
    password: "1",
    deviceId: "wild-device-0001",
  }, { "X-App-Id": app.appId });
  check("an end user with a unicode username and a 1-char password signs in",
    r.status === 200, `got ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);

  // And a wrong password for that same account is still refused: relaxing the
  // shape of a credential must not relax whether it is checked.
  r = await call(null, "POST", "/api/v1/auth/login", {
    username: unicode,
    password: "2",
    deviceId: "wild-device-0002",
  }, { "X-App-Id": app.appId });
  check("but the wrong password for it is still 401", r.status === 401,
    `got ${r.status}`);

  // ── 6. Leave no trace ─────────────────────────────────────────────────
  // Signing in above registered a device, and later phases assert on the
  // application-wide device list. Releasing it keeps this phase independent of
  // where it sits in the run, instead of relying on being scheduled before the
  // device-count assertions.
  r = await call(owner, "GET", `/api/dashboard/applications/${app.id}/devices`);
  const mine = (r.body?.data?.devices ?? [])
    .filter((d) => String(d.deviceId ?? "").startsWith("wild-device-"));
  for (const device of mine) {
    await call(owner, "DELETE",
      `/api/dashboard/applications/${app.id}/devices/${device.id}`);
  }
  check("this phase released the devices it registered", mine.length > 0,
    "no wild device found to release — cleanup assertion is meaningless");

  // ── 5. The DASHBOARD realm is deliberately unchanged ──────────────────
  // Guards against this being read as a global loosening.
  r = await call(owner, "POST", "/api/auth/register", {
    name: "Still Strict", email: "still-strict@example.com",
    username: "ab", password: "alllowercase",
  });
  check("the dashboard still rejects a 2-character username", r.status === 400,
    `got ${r.status}`);
  r = await call(owner, "POST", "/api/auth/register", {
    name: "Still Strict", email: "still-strict2@example.com",
    username: "stillstrict", password: "alllowercase",
  });
  check("the dashboard still enforces the password policy", r.status === 400,
    `got ${r.status}`);
  r = await call(owner, "POST", "/api/auth/register", {
    name: "Still Strict", email: "still-strict3@example.com",
    username: "still strict 3", password: "AllLower1",
  });
  check("the dashboard still restricts username characters", r.status === 400,
    `got ${r.status}`);
}