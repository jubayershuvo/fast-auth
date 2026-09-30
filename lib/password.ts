import "server-only";

import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";

/**
 * Password hashing.
 *
 * bcrypt is used deliberately (over Argon2id) because it is pure JavaScript:
 * it installs and runs identically on Windows/Linux/macOS and inside
 * serverless runtimes with no native toolchain, while providing the same
 * adaptive, salted, slow-hash guarantees.
 *
 * NOTE: bcrypt silently truncates input at 72 bytes. We reject longer
 * passwords at the validation layer so behaviour is explicit rather than a
 * surprise.
 */

const SALT_ROUNDS = 12;
export const MAX_PASSWORD_BYTES = 72;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/**
 * Constant-time-ish password verification provided by bcrypt's own comparison.
 * Returns false (never throws) for malformed hashes so a corrupt DB row cannot
 * crash the request path.
 */
export async function verifyPassword(
  plain: string,
  hash: string | null | undefined,
): Promise<boolean> {
  // An OAuth-only account has no hash. A null/undefined hash is a FAILED
  // comparison, never an error and never a match — otherwise a missing hash
  // could be coerced into granting access.
  if (typeof hash !== "string" || hash.length === 0) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * Generate a random password that satisfies `passwordSchema`.
 *
 * SECURITY: uses `randomInt` from node:crypto, never `Math.random()`. The
 * latter is a seeded PRNG whose output is predictable from a few observed
 * values, which is unacceptable for a credential — and it is exactly what a
 * password generator must not be.
 *
 * The shape is fixed at 16 characters drawn from four classes, so the result
 * ALWAYS satisfies the policy (8+ chars, lower, upper, digit). A generator
 * that can emit a 6-character string is worse than useless: it fails
 * validation at random and the owner believes the reset worked.
 *
 * Uses rejection sampling via randomInt so there is no modulo bias.
 */
export function generatePassword(length = 16): string {
  const LOWER = "abcdefghijkmnopqrstuvwxyz";
  const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const DIGITS = "23456789";
  const SYMBOLS = "!@#$%^&*-_=+";
  const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

  const pick = (set: string): string => set[randomInt(set.length)];

  // One character from each class guarantees the policy regardless of length.
  const chars: string[] = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(ALL));

  // Fisher-Yates so the guaranteed characters are not always in front.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/**
 * Burn roughly one bcrypt's worth of CPU without revealing anything.
 *
 * Called on the "user not found" branch of login so that response time does
 * not leak whether an account exists (user enumeration via timing).
 */
export async function fakeVerifyDelay(): Promise<void> {
  await bcrypt.compare(
    "dummy-password-for-timing-equalisation",
    "$2b$12$C6UzMDM.H6dfI/f/IKcEeO1sT6Q0dXKMHUJ0dW1F6BqJ8m0nZ2hAe",
  );
}
