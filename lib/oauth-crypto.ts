import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

import { env } from "@/lib/env";

/**
 * Encryption for OAuth client secrets at rest.
 *
 * WHY ENCRYPTED AND NOT HASHED: a client secret must be *retrievable* — we
 * need the plaintext to exchange an authorization code for a token. A hash
 * makes that impossible, so the correct storage is reversible encryption.
 *
 * AES-256-GCM with a random 12-byte IV per value. The auth tag is stored and
 * verified on decrypt, so tampering is detected rather than silently
 * producing garbage that would be sent to the provider.
 *
 * The key is derived from SESSION_SECRET via scrypt, so rotating the session
 * secret also rotates the encryption key (which is why an existing provider
 * config will need re-saving after such a change).
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const SALT = "fastauth-oauth-v1";
const KEY_CACHE: { salt: string; key: Buffer | null } = { salt: SALT, key: null };

function deriveKey(): Buffer {
  if (KEY_CACHE.key) return KEY_CACHE.key;
  // scrypt is deliberately slow, so the derived key is cached per process
  // and costs nothing after the first derivation.
  KEY_CACHE.key = scryptSync(env.sessionSecret, KEY_CACHE.salt, 32);
  return KEY_CACHE.key;
}

/** Encrypt a secret. Output format: `v1.<iv>.<authTag>.<ciphertext>` (base64url). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, deriveKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/** Decrypt a secret produced by `encryptSecret`. Throws if tampered with. */
export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Malformed encrypted secret.");
  }
  const [, ivRaw, tagRaw, dataRaw] = parts;

  const decipher = createDecipheriv(
    ALGORITHM,
    deriveKey(),
    Buffer.from(ivRaw, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Non-reversible hint so the UI can show *that* a secret is set, never what. */
export function secretHint(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;
  return `••••••••${plaintext.slice(-4)}`;
}

/** Constant-time comparison for provider secrets. */
export function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
