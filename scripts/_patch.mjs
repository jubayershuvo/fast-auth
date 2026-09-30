import fs from "node:fs";

const p = "scripts/phases/phase16-api-keys.mjs";
let s = fs.readFileSync(p, "utf8");

// `ctx.app2` belongs to the SAME owner as `ctx.app` (see phase 2), so an IDOR
// test against it proves nothing — the key would legitimately be allowed there.
const re = /  \/\/ ── 6\. The cross-tenant IDOR guard[\s\S]*?JSON\.stringify\(crossRead\.body\) === JSON\.stringify\(missing\.body\)\);\n/;
if (!re.test(s)) {
  console.error("MARKER_NOT_FOUND");
  process.exit(1);
}

const replacement = `  // ── 6. The cross-tenant IDOR guard — the important one ────────────────
  // A SECOND, genuinely different customer. \`ctx.app2\` belongs to the SAME owner
  // as \`ctx.app\` (see phase 2), so reaching it would be legitimate and would
  // prove nothing: the key would simply be allowed to go there.
  const stranger = new Session();
  await call(stranger, "POST", "/api/auth/register", {
    name: "Sam Stranger",
    email: "stranger@example.com",
    username: "stranger",
    password: "Stranger123",
  });
  const strangerApp = await call(stranger, "POST", "/api/dashboard/applications", {
    name: "Stranger App",
  });
  check(
    "a second, independent customer exists for the IDOR test",
    strangerApp.status === 201,
    \`got \${strangerApp.status}\`,
  );
  const strangerAppId = strangerApp.body?.data?.id;

  const crossRead = await keyed(
    appKey,
    "GET",
    \`/api/keys/applications/\${strangerAppId}\`,
  );
  check(
    "an app key cannot read ANOTHER TENANT's application (404)",
    crossRead.status === 404,
    \`got \${crossRead.status}\`,
  );

  const crossWrite = await keyed(
    appKey,
    "POST",
    \`/api/keys/applications/\${strangerAppId}/users\`,
    { username: "intruder", name: "Intruder", password: "Intruder1" },
  );
  check(
    "an app key cannot create users in ANOTHER TENANT (404)",
    crossWrite.status === 404,
    \`got \${crossWrite.status}\`,
  );

  // The intruder must genuinely not exist in the other tenant.
  const strangerUsers = await call(
    stranger,
    "GET",
    \`/api/dashboard/applications/\${strangerAppId}/users\`,
  );
  check(
    "no user was actually created in the other tenant",
    !(strangerUsers.body?.data?.users ?? []).some((u) => u.username === "intruder"),
    JSON.stringify(strangerUsers.body?.data?.users),
  );

  // A nonexistent id must look identical, or the API becomes an id oracle.
  const missing = await keyed(
    appKey,
    "GET",
    "/api/keys/applications/000000000000000000000000",
  );
  check(
    "an unknown application id is also 404",
    missing.status === 404,
    \`got \${missing.status}\`,
  );
  check(
    "a cross-tenant read and an unknown id are indistinguishable",
    JSON.stringify(crossRead.body) === JSON.stringify(missing.body),
  );
`;

s = s.replace(re, replacement);
s = s.split('mintKey({ name: "suite-revoked"').join('mintKey(ApiKey, { name: "suite-revoked"');
s = s.split("const expiredKey = await mintKey({").join("const expiredKey = await mintKey(ApiKey, {");

fs.writeFileSync(p, s);
console.log("patched");
