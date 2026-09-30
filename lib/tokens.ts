import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

/**
 * Token generation and hashing.
 *
 * Design note — why SHA-256 and not bcrypt for tokens:
 *  - Tokens are 256 bits of CSPRNG output, so there is no dictionary to brute
 *    force. Their security rests on unpredictability, not on slowness.
 *  - They are looked up on EVERY authenticated request. A slow KDF here would
 *    add ~100ms of latency per API call for no added protection.
 *  - Bcrypt also truncates at 72 bytes, which would risk token collisions.
 * So: CSPRNG for generation, SHA-256 (salted with the app secret) for storage.
 * Passwords keep the slow KDF in lib/password.ts.
 */

const TOKEN_BYTES = 32; // 256 bits of entropy

/** URL-safe random token. Returned to the client exactly once. */
export function generateToken(bytes: number = TOKEN_BYTES): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Deterministic hash of a token. Only this value is persisted, so a database
 * leak cannot be replayed against the API.
 *
 * The secret is mixed in (HMAC-style) so that hashes are useless even if the
 * same token value were reused across deployments.
 */
export function hashToken(token: string): string {
  return createHash("sha256")
    .update(`${env.sessionSecret}:${token}`, "utf8")
    .digest("hex");
}

/** Constant-time string comparison that never throws on length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Still perform a comparison to keep timing roughly uniform.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

const APP_ID_PREFIX = "fa_";
const APP_SECRET_PREFIX = "fas_";
const API_KEY_PREFIX = "fak_";

/**
 * Public application identifier, e.g. `fa_9Xq2...`.
 * Human-scannable, safe to embed in client code, not a secret by itself.
 */
export function generateAppId(): string {
  return `${APP_ID_PREFIX}${randomBytes(12).toString("base64url")}`;
}

/**
 * Application secret, e.g. `fas_...`. This IS a credential — shown once at
 * creation/rotation and stored only as a hash.
 */
export function generateAppSecret(): string {
  return `${APP_SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Last 4 chars of a secret, so owners can recognise which secret is live. */
export function secretFingerprint(secret: string): string {
  return secret.slice(-4);
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

/**
 * Management API key, e.g. `fak_...`. This IS a credential — shown once by
 * `npm run create-api-key` and stored only as a hash.
 *
 * 32 random bytes, the same budget as a session token: the key is looked up on
 * every management call, so it needs unpredictability, not a slow KDF.
 */
export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/**
 * Leading characters of a key, shown in listings so an operator can tell two
 * keys apart without revealing either in full.
 */
export function apiKeyPrefix(key: string): string {
  return key.slice(0, API_KEY_PREFIX.length + 6);
}

/** Short, human-friendly id for device records shown in the UI. */
export function shortId(length = 8): string {
  return randomBytes(8).toString("hex").slice(0, length);
}
