/**
 * End-to-end verification against a REAL MongoDB instance.
 *
 * Run:  npm run verify
 *
 * Boots an ephemeral in-memory MongoDB, starts the production Next.js server,
 * then drives the whole lifecycle over HTTP exactly as a customer and an end
 * user would. This verifies BEHAVIOUR, not just types: tenant isolation,
 * ban/expiry/device enforcement, and that no secret or hash leaves the server.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import mongoose from "mongoose";

import { PORT, SESSION_SECRET, tally } from "./harness.mjs";
import { MAIL_OUTBOX } from "./mail-inbox.mjs";
import { startMockProvider } from "./mock-oauth-provider.mjs";
import { phase1Auth } from "./phases/phase1-auth.mjs";
import { phase2Applications } from "./phases/phase2-applications.mjs";
import { phase3Users } from "./phases/phase3-users.mjs";
import { phase4Login } from "./phases/phase4-login.mjs";
import { phase5DevicesBansExpiry } from "./phases/phase5-devices-bans-expiry.mjs";
import { phase6Sessions } from "./phases/phase6-sessions.mjs";
import { phase7StatsLogs } from "./phases/phase7-stats-logs.mjs";
import { phase8Hardening } from "./phases/phase8-hardening.mjs";
import { phase9Indexes } from "./phases/phase9-indexes.mjs";
import { phase10Pages } from "./phases/phase10-pages.mjs";
import { phase11Admin } from "./phases/phase11-admin.mjs";
import { phase12OAuth, phase13AdminOAuth } from "./phases/phase12-oauth.mjs";
import { phase14Plans } from "./phases/phase14-plans.mjs";
import { phase15Docs } from "./phases/phase15-docs.mjs";
import { phase16ApiKeys } from "./phases/phase16-api-keys.mjs";
import { phase17Accounts } from "./phases/phase17-accounts.mjs";
import { phase18AuthMethods } from "./phases/phase18-auth-methods.mjs";
import { phase19PasswordReset, phase19PasswordSet } from "./phases/phase19-password-reset.mjs";
import { phase20AppUserCredentials } from "./phases/phase20-app-user-credentials.mjs";
import { phase21Portal } from "./phases/phase21-portal.mjs";

/**
 * Turn email+password ON for the run.
 *
 * A fresh install now defaults this method to OFF (see lib/auth-method.ts), which
 * is the honest, safe answer: without a mail transport nobody can verify an
 * address or claim a password. Almost every other phase signs in with a
 * password, so the suite must configure the method deliberately rather than
 * relying on a permissive default that production no longer ships.
 *
 * Written straight to Mongo rather than through the admin API because the
 * server is already running with its own connection, and because phase 18 owns
 * the "what the panel does" question — this is only the starting state.
 */
async function enableEmailPassword(uri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15_000 });
  // Inline schema, as the other phases do — the suite runs under plain Node and
  // cannot import `models/*.ts`.
  const model =
    mongoose.models.AuthMethod
    ?? mongoose.model("AuthMethod", new mongoose.Schema({
      method: { type: String, required: true, index: true },
      enabled: { type: Boolean, default: false },
      allowRegistration: { type: Boolean, default: false },
      smtpHost: { type: String, default: null },
      smtpPort: { type: Number, default: 587 },
      smtpSecure: { type: String, default: "starttls" },
      smtpUser: { type: String, default: null },
      smtpPasswordEncrypted: { type: String, default: null },
      mailFrom: { type: String, default: null },
      updatedBy: { type: String, default: null },
    }, { timestamps: true, collection: "auth_methods" }), "auth_methods");

  // `upsert` so a rerun against a persisted database is still deterministic.
  await model.updateOne(
    { method: "email_password" },
    { $set: { enabled: true, allowRegistration: true } },
    { upsert: true },
  );
  await mongoose.disconnect();
}

async function main() {
  console.log("Booting in-memory MongoDB (replica set, to exercise transactions)...");
  // A single-node replica set is required so multi-document transactions are
  // available — that is how Atlas and any production deployment is configured,
  // and it lets the suite verify the transactional cascade deletes.
  const mongo = await MongoMemoryServer.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const uri = mongo.getUri();
  console.log(`  ${uri}`);

  // Start from an empty inbox so a stale file from a previous run cannot supply
  // a code that "worked" for the wrong reason.
  if (existsSync(MAIL_OUTBOX)) rmSync(MAIL_OUTBOX);

  // Spawn the CLI's JS entry directly: on Windows `node_modules/.bin/next` is a
  // shell script that cannot be exec'd from Node.
  const nextBin = fileURLToPath(
    new URL("../node_modules/next/dist/bin/next", import.meta.url),
  );

  console.log("Starting fake OAuth provider...");
  const mockProvider = await startMockProvider();

  // Build first. `next start` serves whatever is already in .next, so without
  // this the suite can pass against a STALE build and prove nothing about the
  // code on disk — it has already hidden one real cookie-scoping bug.
  console.log("Building (so the suite tests current code)...");
  const build = spawn(process.execPath, [nextBin, "build"], {
    env: { ...process.env, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    let log = "";
    build.stdout.on("data", (d) => { log += d; });
    build.stderr.on("data", (d) => { log += d; });
    build.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`next build failed (${code}):\n${log.slice(-2000)}`)),
    );
  });

  console.log("Starting Next.js production server...");
  const server = spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], {
    env: {
      ...process.env,
      MONGODB_URI: uri,
      SESSION_SECRET,
      COOKIE_SECURE: "false",
      NODE_ENV: "production",
      // No real SMTP: the mailer falls back to its console transport and appends
      // every message here, so the suite can read verification codes out of a
      // file instead of running a mail server. See scripts/mail-inbox.mjs.
      MAIL_OUTBOX_FILE: MAIL_OUTBOX,
      // Loopback-only test override so the suite can drive the real PKCE flow
      // against a fake provider. See lib/oauth-providers.ts.
      OAUTH_ALLOW_TEST_ENDPOINTS: "1",
      OAUTH_TEST_AUTHORIZE_URL: `${mockProvider.origin}/authorize`,
      OAUTH_TEST_TOKEN_URL: `${mockProvider.origin}/token`,
      OAUTH_TEST_USERINFO_URL: `${mockProvider.origin}/userinfo`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", () => {});
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

  let up = false;
  for (let i = 0; i < 60; i += 1) {
    await sleep(1000);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/login`);
      if (res.ok) { up = true; break; }
    } catch {
      /* keep polling */
    }
  }
  if (!up) {
    console.error("Server never became ready.");
    server.kill();
    await mongo.stop();
    process.exit(1);
  }

  // Before the first phase: a fresh install leaves email+password OFF, and
  // almost every phase signs in with a password. Configure it deliberately so
  // the suite exercises a working deployment instead of depending on a default.
  await enableEmailPassword(uri);

  // State threaded between phases.
  const ctx = {
    app: null,
    app2: null,
    player: null,
    player2: null,
    token1: null,
    uri,
    // The SAME fake provider the server was pointed at, so the suite can
    // inspect what it was asked for. Starting a second one would bind a
    // different port and the app would never talk to it.
    mockProvider,
  };

  try {
    // Sequential: each phase depends on state produced by the previous one.
    await phase1Auth(ctx);
    await phase2Applications(ctx);
    await phase3Users(ctx);
    // Asserts the app-user realm's credential rules, and that the dashboard
    // realm's stricter rules were deliberately left alone.
    await phase20AppUserCredentials(ctx);
    await phase4Login(ctx);
    // After the v1 login phase, so `ctx.player` exists for the portal to use as
    // a second end user. Before phase 5, because this phase creates device rows
    // and phase 5 asserts on the application-wide device count.
    await phase21Portal(ctx);
    await phase5DevicesBansExpiry(ctx);
    await phase6Sessions(ctx);
    await phase7StatsLogs(ctx);
    // Runs before phase 8, which signs the owner out and deletes an app.
    await phase9Indexes(ctx);
    await phase10Pages(ctx);
    await phase11Admin(ctx);
    await phase12OAuth(ctx);
    await phase13AdminOAuth(ctx);
    await phase14Plans(ctx);
    await phase15Docs(ctx);
    // Runs before phase 8, which tears down applications and sessions.
    await phase16ApiKeys(ctx);
    await phase17Accounts(ctx);
    // Runs BEFORE phase 18: it needs password sign-in to work, and phase 18
    // deliberately leaves email+password switched off. Case B also depends on
    // the platform-created account phase 17 made above.
    await phase19PasswordReset(ctx);
    await phase19PasswordSet(ctx);
    // Restores the default configuration before it returns, so it must run
    // before anything that needs password sign-in to work.
    await phase18AuthMethods(ctx);
    await phase8Hardening(ctx);
  } catch (error) {
    // A crash mid-suite used to print the tally and still exit 0, so a suite
    // that died after 121 checks looked identical to a green run. A phase that
    // throws is a FAILED verification, never a pass.
    console.error("\nUnexpected error during verification:", error);
    process.exitCode = 1;
  } finally {
    server.kill();
    await mockProvider.close();
    await mongo.stop();
  }

  const { passed, failed, failures } = tally();
  console.log(`\n${"─".repeat(58)}`);
  console.log(`  \x1b[1m${passed} passed\x1b[0m, ${failed ? `\x1b[31m${failed} failed\x1b[0m` : "0 failed"}`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
