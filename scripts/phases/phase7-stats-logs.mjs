import { check, section, call } from "../harness.mjs";

/** Phase 7 — statistics and the authentication audit trail. */
export async function phase7StatsLogs(ctx) {
  section("Phase 7 — statistics and audit log");
  const { owner, intruder, app } = ctx;

  let r = await call(owner, "GET", `/api/dashboard/applications/${app.id}/stats`);
  check("the stats endpoint responds", r.status === 200, JSON.stringify(r.body).slice(0, 200));
  check("stats counts total users", r.body.data?.total >= 2, JSON.stringify(r.body.data));
  check("stats reports active/banned/expired buckets",
    typeof r.body.data?.active === "number" &&
    typeof r.body.data?.banned === "number" &&
    typeof r.body.data?.expired === "number", JSON.stringify(r.body.data));

  r = await call(owner, "GET", `/api/dashboard/applications/${app.id}/logs?limit=100`);
  check("the logs endpoint responds", r.status === 200, JSON.stringify(r.body).slice(0, 150));
  const logs = r.body.data?.logs ?? [];
  check("the log list is populated", logs.length > 0, `got ${logs.length}`);

  const actions = new Set(logs.map((l) => l.action));
  for (const expected of [
    "LOGIN_SUCCESS", "LOGIN_FAILED", "ACCOUNT_BANNED", "ACCOUNT_UNBANNED",
    "ACCOUNT_EXPIRED", "DEVICE_ADDED", "SESSION_CREATED", "SESSION_REVOKED", "LOGOUT",
  ]) {
    check(`the audit log recorded ${expected}`, actions.has(expected),
      `saw: ${[...actions].join(", ")}`);
  }

  check("logs carry the username snapshot", logs.some((l) => l.username === "player123"));
  check("logs carry the IP address", logs.some((l) => l.ip !== null));
  // This used to be a crude `!includes("password")` substring check, which passed
  // by luck and then broke the moment a legitimate action was named
  // PASSWORD_RESET. The actual guarantee we care about is that no credential
  // VALUE is persisted in the audit trail, so assert on the values and on hash
  // markers instead of on a word.
  const logBlob = JSON.stringify(logs);
  const knownPasswords = ["Player123", "Owner123", "Device123", "Secret123"];
  check("logs contain no password material",
    knownPasswords.every((p) => !logBlob.includes(p)),
    "a plaintext password appears in the audit trail");
  check("logs contain no bcrypt hash",
    !logBlob.includes("$2b$") && !logBlob.includes("$2a$") && !logBlob.includes("$2y$"),
    "a password hash appears in the audit trail");
  check("logs contain no passwordHash field",
    !logBlob.includes("passwordHash"), "a passwordHash field leaked into the audit trail");
  // The action name is allowed to say "PASSWORD_RESET" — it is a label, not a
  // secret. What must not accompany it is a credential.
  const resetEntry = logs.find((l) => l.action === "PASSWORD_RESET");
  if (resetEntry) {
    check("the PASSWORD_RESET audit entry carries no secret",
      !knownPasswords.some((p) => JSON.stringify(resetEntry).includes(p)),
      JSON.stringify(resetEntry));
  }
  check("logs contain no session tokens",
    !JSON.stringify(logs).includes(ctx.token1 ?? "___none___"));
  check("logs are newest first",
    logs.length < 2 || new Date(logs[0].createdAt) >= new Date(logs[1].createdAt));

  r = await call(owner, "GET", `/api/dashboard/applications/${app.id}/devices`);
  check("the devices endpoint responds", r.status === 200);
  r = await call(owner, "GET", `/api/dashboard/applications/${app.id}/sessions`);
  check("the sessions endpoint responds", r.status === 200);
  r = await call(owner, "GET", `/api/dashboard/applications/${app.id}/users?status=banned`);
  check("filtering users by banned status works", r.status === 200, `got ${r.status}`);

  r = await call(intruder, "GET", `/api/dashboard/applications/${app.id}/logs`);
  check("IDOR: other customer cannot read the audit log", r.status === 404, `got ${r.status}`);

  r = await call(intruder, "GET", `/api/dashboard/applications/${app.id}/stats`);
  check("IDOR: other customer cannot read the stats", r.status === 404, `got ${r.status}`);
}
