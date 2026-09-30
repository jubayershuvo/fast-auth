/**
 * Create a platform administrator.
 *
 *   npm run create-admin
 *   npm run create-admin -- --email=me@example.com --username=owner
 *   npm run create-admin -- --email=me@example.com --password='Str0ngPass!'
 *
 * SECURITY MODEL
 * This CLI is the ONLY way an administrator can be created. There is
 * deliberately no HTTP endpoint for it: if admin creation were reachable over
 * the network, any registration flaw anywhere in the app would become a
 * full-platform compromise.
 *
 * It runs outside the Next.js runtime, so it reads MONGODB_URI from .env.local
 * directly rather than through lib/env.ts.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

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

const SALT_ROUNDS = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9_.-]{3,32}$/;

/** Same complexity policy the customer registration endpoint enforces. */
function passwordProblems(password) {
  const problems = [];
  if (password.length < 8) problems.push("at least 8 characters");
  if (!/[a-z]/.test(password)) problems.push("a lowercase letter");
  if (!/[A-Z]/.test(password)) problems.push("an uppercase letter");
  if (!/[0-9]/.test(password)) problems.push("a number");
  return problems;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  for (const file of [".env.local", ".env"]) {
    loadEnvFile(resolve(process.cwd(), file));
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set. Add it to .env.local first.");
    process.exit(1);
  }

  const email = String(args.email ?? "").trim().toLowerCase();
  const username = String(args.username ?? "").trim().toLowerCase();

  if (!EMAIL_RE.test(email)) {
    console.error("A valid --email is required.");
    process.exit(1);
  }
  if (!USERNAME_RE.test(username)) {
    console.error(
      "--username is required: 3-32 chars, letters/numbers/dot/dash/underscore.",
    );
    process.exit(1);
  }

  // A password is accepted as a flag for automation, but generating a strong
  // one by default means an admin is never created with a weak password.
  const generated = !args.password;
  const password = String(
    args.password ??
      `Fa-${Math.random().toString(36).slice(2, 8)}-${Math.random()
        .toString(36)
        .slice(2, 8)}-a1`,
  );

  const problems = passwordProblems(password);
  if (problems.length > 0) {
    console.error(`Password must contain: ${problems.join(", ")}.`);
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15_000 });

  try {
    // Declared inline rather than imported from models/AdminUser.ts, because
    // this script runs under plain Node without a TypeScript loader. The field
    // names, indexes and collection match the app's schema exactly.
    const schema = new mongoose.Schema(
      {
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        username: { type: String, required: true, unique: true, lowercase: true, trim: true },
        passwordHash: { type: String, required: true },
        lastLoginAt: { type: Date, default: null },
        lastLoginIp: { type: String, default: null },
      },
      { timestamps: true, collection: "admin_users" },
    );
    const AdminUser =
      mongoose.models.AdminUser ??
      mongoose.model("AdminUser", schema, "admin_users");

    const existing = await AdminUser.findOne({
      $or: [{ email }, { username }],
    }).lean();
    if (existing) {
      console.error(
        `An administrator already exists with that ${existing.email === email ? "email" : "username"}.`,
      );
      process.exit(1);
    }

    const created = await AdminUser.create({
      email,
      username,
      passwordHash: await bcrypt.hash(password, SALT_ROUNDS),
    });

    console.log("\n  Administrator created");
    console.log(`  id       ${created._id.toString()}`);
    console.log(`  email    ${email}`);
    console.log(`  username ${username}`);
    if (generated) {
      console.log(`\n  Generated password: ${password}`);
      console.log("  Store it in a password manager now — it is not shown again.");
    }
    console.log("\n  Sign in at /admin/login\n");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("Failed to create administrator:", error?.message ?? error);
  process.exit(1);
});
