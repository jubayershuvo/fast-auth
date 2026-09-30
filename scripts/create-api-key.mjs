/**
 * Issue a management API key.
 *
 *   npm run create-api-key -- --name=ci-deploy --scope=platform
 *   npm run create-api-key -- --name=billing-sync --scope=app --app=<appId>
 *   npm run create-api-key -- --days=90
 *   npm run create-api-key -- --revoke=<keyId>
 *   npm run create-api-key -- --list
 *
 * SECURITY MODEL
 * This CLI is the ONLY way an API key can be created. There is deliberately no
 * HTTP endpoint for it — the same reasoning as `create-admin`. A key is a
 * bearer credential that can provision users and, at platform scope, read every
 * tenant; if minting one were reachable over the network, any registration flaw
 * anywhere in the app would become a full-platform compromise.
 *
 * It runs outside the Next.js runtime, so it reads MONGODB_URI from .env.local
 * directly rather than through lib/env.ts.
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import mongoose from "mongoose";

/** Minimal .env parser — avoids pulling dotenv in just for a CLI. */
function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Real environment variables win over the file.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(item);
    if (match) args[match[1]] = match[2] ?? true;
  }
  return args;
}

/**
 * Identical to `hashToken` in lib/tokens.ts.
 *
 * Duplicated rather than imported because this script runs under plain Node with
 * no TypeScript loader, and an import that silently drifted from the app's
 * algorithm would mint keys that no request could ever authenticate.
 */
function hashToken(token, secret) {
  return createHash("sha256")
    .update(`${secret}:${token}`, "utf8")
    .digest("hex");
}

const API_KEY_PREFIX = "fak_";

function generateApiKey() {
  return `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

function apiKeyPrefix(key) {
  return key.slice(0, API_KEY_PREFIX.length + 6);
}

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;
const PUBLIC_APP_ID_RE = /^fa_[A-Za-z0-9_-]{16}$/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

/**
 * Accept either identifier form for the pinned application.
 *
 * Scripts are written by humans, and an operator holding the `fa_...` id from
 * the dashboard is far more likely to paste that than the ObjectId. Accepting
 * both here removes a whole class of "why is my key rejected" confusion — and
 * the lookup below is unambiguous, since the two formats cannot collide.
 */
async function resolveApplication(Application, raw) {
  if (OBJECT_ID_RE.test(raw)) {
    return Application.findOne({ _id: new mongoose.Types.ObjectId(raw) }).lean();
  }
  if (PUBLIC_APP_ID_RE.test(raw)) {
    return Application.findOne({ appId: raw }).lean();
  }
  fail(
    "--app must be either an application ObjectId (24 hex chars) or the " +
      "public appId (fa_XXXXXXXXXXXXXXXX).",
  );
  return null;
}


const SCHEMA = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 64 },
    keyHash: { type: String, required: true, unique: true, index: true },
    keyPrefix: { type: String, required: true, maxlength: 24 },
    keyFingerprint: { type: String, required: true, maxlength: 8 },
    scope: { type: String, enum: ["platform", "app"], required: true, index: true },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      default: null,
      index: true,
    },
    expiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
    lastUsedIp: { type: String, default: null, maxlength: 64 },
  },
  { timestamps: true, collection: "api_keys" },
);

function printKeys(keys) {
  if (keys.length === 0) {
    console.log("\n  No API keys yet.\n");
    return;
  }
  console.log("");
  for (const key of keys) {
    const state = key.revokedAt
      ? "REVOKED"
      : key.expiresAt && key.expiresAt.getTime() <= Date.now()
        ? "EXPIRED"
        : "active";
    console.log(`  ${key._id.toString()}  ${key.scope.padEnd(8)} ${state}`);
    console.log(`    name        ${key.name}`);
    console.log(`    key         ${key.keyPrefix}…${key.keyFingerprint}`);
    if (key.applicationId) console.log(`    application ${key.applicationId.toString()}`);
    if (key.expiresAt) console.log(`    expires     ${key.expiresAt.toISOString()}`);
    if (key.lastUsedAt) console.log(`    last used   ${key.lastUsedAt.toISOString()}`);
  }
  console.log("");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  for (const file of [".env.local", ".env"]) {
    loadEnvFile(resolve(process.cwd(), file));
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) fail("MONGODB_URI is not set. Add it to .env.local first.");

  // SESSION_SECRET salts the key hash, exactly as it does for tokens. Without
  // it we cannot produce a hash the server would ever accept, so refuse here
  // rather than mint a key that is dead on arrival.
  const secret = process.env.SESSION_SECRET;
  if (!secret) fail("SESSION_SECRET is not set. Add it to .env.local first.");

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15_000 });

  try {
    const ApiKey =
      mongoose.models.ApiKey ?? mongoose.model("ApiKey", SCHEMA, "api_keys");
    const Application =
      mongoose.models.Application ??
      mongoose.model(
        "Application",
        new mongoose.Schema(
          { appId: { type: String, index: true }, name: String },
          { collection: "applications" },
        ),
        "applications",
      );

    // ── --list ──────────────────────────────────────────────────────────
    if (args.list) {
      printKeys(await ApiKey.find().sort({ createdAt: -1 }).lean());
      return;
    }

    // ── --revoke ────────────────────────────────────────────────────────
    if (args.revoke) {
      const keyId = String(args.revoke);
      if (!OBJECT_ID_RE.test(keyId)) fail("--revoke must be a key ObjectId.");
      const revoked = await ApiKey.findByIdAndUpdate(
        keyId,
        { $set: { revokedAt: new Date() } },
        { returnDocument: "after" },
      ).lean();
      if (!revoked) fail(`No API key with id ${keyId}.`);
      console.log(`\n  Revoked "${revoked.name}" (${revoked.keyPrefix}…).\n`);
      return;
    }

    // ── --create ────────────────────────────────────────────────────────
    const name = String(args.name ?? "").trim();
    if (!name) fail("--name is required, e.g. --name=ci-deploy.");
    if (name.length > 64) fail("--name must be at most 64 characters.");

    const scope = String(args.scope ?? "app");
    if (scope !== "app" && scope !== "platform") {
      fail("--scope must be either 'app' or 'platform'.");
    }

    let applicationId = null;
    let applicationLabel = null;
    if (scope === "app") {
      if (!args.app) {
        fail(
          "--scope=app requires --app=<id>. An app-scoped key without an " +
            "application would be a platform key wearing a disguise.",
        );
      }
      const application = await resolveApplication(
        Application,
        String(args.app),
      );
      if (!application) fail(`No application matches "${args.app}".`);
      applicationId = application._id;
      applicationLabel = application.appId ?? application._id.toString();
    } else if (args.app) {
      fail("--app only applies to --scope=app. A platform key is not pinned.");
    }

    // Absolute expiry, never a duration stored on the row: the server must be
    // able to answer "is this expired?" without trusting a countdown that a
    // stopped process would have frozen.
    let expiresAt = null;
    if (args.days) {
      const days = Number.parseInt(String(args.days), 10);
      if (!Number.isFinite(days) || days <= 0) {
        fail("--days must be a positive whole number.");
      }
      expiresAt = new Date(Date.now() + days * 86_400_000);
    }

    const plaintext = generateApiKey();

    const created = await ApiKey.create({
      name,
      keyHash: hashToken(plaintext, secret),
      keyPrefix: apiKeyPrefix(plaintext),
      keyFingerprint: plaintext.slice(-4),
      scope,
      applicationId,
      expiresAt,
    });

    const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    console.log("\n  API key created");
    console.log(`  id         ${created._id.toString()}`);
    console.log(`  name       ${created.name}`);
    console.log(`  scope      ${scope}`);
    if (applicationLabel) console.log(`  app        ${applicationLabel}`);
    if (expiresAt) console.log(`  expires    ${expiresAt.toISOString()}`);
    console.log(`\n  ${plaintext}\n`);
    console.log("  This is the ONLY time the key is shown. It is stored as a hash");
    console.log("  and cannot be recovered — store it in your secret manager now.");
    console.log(
      `\n  Verify it with:  curl ${base}/api/keys/me -H "X-Api-Key: ${plaintext}"\n`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("Failed to create API key:", error?.message ?? error);
  process.exit(1);
});
