/**
 * Audit: every route handler on disk vs. every endpoint in the doc registry.
 *
 * Run with `node scripts/audit-docs.mjs`. Exits non-zero when the two disagree,
 * so drift fails loudly instead of quietly shipping.
 *
 * NOT exhaustive by design: `/api/health` is an infrastructure probe and the
 * OAuth start/callback routes are browser redirects. Neither is part of the
 * customer-facing contract, so both are excluded below rather than documented.
 */
import fs from "node:fs";
import path from "node:path";

const REGISTRY = ["v1", "keys", "dashboard", "portal", "admin"].map(
  (f) => `lib/api-docs/${f}.ts`,
);

/** Documented with `{braces}`, the way the registry and OpenAPI write paths. */
const normalise = (route) => route.replace(/\[(\w+)\]/g, "{$1}");

/** Genuinely not part of the customer API contract. */
const EXCLUDED = [
  "/api/health",
  "/api/auth/oauth/{provider}/start",
  "/api/auth/oauth/{provider}/callback",
  "/api/admin/oauth/{provider}/start",
  "/api/admin/oauth/{provider}/callback",
];

const documented = [];
for (const file of REGISTRY) {
  const src = fs.readFileSync(file, "utf8");
  // `method` and `path` are adjacent by construction in this registry; a loose
  // match would pair fields across separate endpoint objects.
  const re = /method:\s*"(\w+)",\s*\n\s*path:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) documented.push(`${m[1]} ${normalise(m[2])}`);
}

const real = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === "route.ts") {
      const src = fs.readFileSync(full, "utf8");
      const route = normalise(
        full.replace(/\\/g, "/").replace(/^app/, "").replace(/\/route\.ts$/, ""),
      );
      if (EXCLUDED.includes(route)) continue;
      for (const m of src.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)/g)) {
        real.push(`${m[1]} ${route}`);
      }
    }
  }
})("app/api");

const missing = real.filter((x) => !documented.includes(x)).sort();
const extra = documented.filter((x) => !real.includes(x)).sort();

console.log(`documented: ${documented.length}   implemented: ${real.length}`);
console.log("\nIN CODE BUT NOT DOCUMENTED");
missing.forEach((x) => console.log("  " + x));
console.log("\nDOCUMENTED BUT NOT IN CODE");
extra.forEach((x) => console.log("  " + x));

// The error-code table must cover every code the API can actually return, or a
// developer hits one the docs never mention.
const errorsSrc = fs.readFileSync("lib/errors.ts", "utf8");
const block = errorsSrc.slice(errorsSrc.indexOf("export const ErrorCode"));
const implemented = [...block.matchAll(/^\s{2}([A-Z_0-9]+):/gm)].map((m) => m[1]);

const typesSrc = fs.readFileSync("lib/api-docs/types.ts", "utf8");
const listed = [...typesSrc.matchAll(/\{ code: "([A-Z_0-9]+)"/g)].map((m) => m[1]);

const undocumentedCodes = implemented.filter((c) => !listed.includes(c)).sort();
const phantomCodes = listed.filter((c) => !implemented.includes(c)).sort();

console.log("\nERROR CODES IMPLEMENTED BUT NOT LISTED");
undocumentedCodes.forEach((c) => console.log("  " + c));
console.log("\nERROR CODES LISTED BUT NOT IMPLEMENTED");
phantomCodes.forEach((c) => console.log("  " + c));

process.exitCode =
  missing.length || extra.length || undocumentedCodes.length || phantomCodes.length ? 1 : 0;
