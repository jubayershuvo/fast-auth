import "server-only";

import { cookies } from "next/headers";
import type { Types } from "mongoose";

import { env } from "@/lib/env";
import { ApiError } from "@/lib/errors";
import { connectToDatabase } from "@/lib/mongodb";
import { DashboardSessionModel } from "@/models/DashboardSession";

/**
 * Dashboard session management.
 *
 * Flow:
 *   1. Generate a 256-bit random token.
 *   2. Store ONLY its SHA-256 hash in Mongo.
 *   3. Put the raw token in an httpOnly, SameSite=Lax, Secure cookie.
 *   4. Every request: hash the cookie, look up, check expiry + revocation.
 *
 * The cookie is never readable from JavaScript (`httpOnly`), so XSS cannot
 * exfiltrate it, and it is `SameSite=Lax` so it is not attached to
 * cross-site POSTs (CSRF defence).
 */

export const SESSION_COOKIE_NAME = "fa_session";

export type DashboardSessionUser = {
  id: string;
  email: string;
  username: string;
  /** Display name. Falls back to the username for rows predating the field. */
  name: string;
};

export type CreatedSession = {
  token: string;
  expiresAt: Date;
};

/** Cookie options shared by set/clear so they can never drift apart. */
function cookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

export async function createSession(
  userId: Types.ObjectId | string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<CreatedSession> {
  await connectToDatabase();

  const { generateToken, hashToken } = await import("@/lib/tokens");
  const token = generateToken();
  const expiresAt = new Date(Date.now() + env.dashboardSessionTtlMs);

  await DashboardSessionModel.create({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    revokedAt: null,
    lastUsedAt: new Date(),
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, cookieOptions(expiresAt));

  return { token, expiresAt };
}

/** Read the raw cookie value, or null when not signed in. */
export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value ?? null;
}

/**
 * Resolve a session cookie to its owner.
 *
 * Returns null for every failure mode (missing, unknown, expired, revoked,
 * or deleted user) so callers have a single simple check. This is the
 * "optimistic check with proxy" the Next.js auth guide recommends, and it is
 * ALSO the real check — it always hits the database.
 */
export async function getSessionUser(): Promise<DashboardSessionUser | null> {
  const token = await readSessionToken();
  if (!token) return null;

  const { hashToken } = await import("@/lib/tokens");
  const tokenHash = hashToken(token);

  await connectToDatabase();

  const session = await DashboardSessionModel.findOne({ tokenHash }).lean();
  if (!session) return null;
  if (session.revokedAt !== null) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  // Imported here to avoid a circular import at module-evaluation time.
  const { UserModel } = await import("@/models/User");
  const user = await UserModel.findById(session.userId).lean();
  if (!user) return null;

  // Fire-and-forget activity timestamp; never block the request on it.
  void DashboardSessionModel.updateOne(
    { _id: session._id },
    { $set: { lastUsedAt: new Date() } },
  ).catch(() => undefined);

  return {
    id: user._id.toString(),
    email: user.email,
    username: user.username,
    // Read live, not cached, so a name change shows up on the next request.
    name: user.name?.trim() || user.username,
  };
}

/** Revoke the current session (logout). Idempotent. */
export async function destroySession(): Promise<void> {
  const token = await readSessionToken();
  if (token) {
    const { hashToken } = await import("@/lib/tokens");
    try {
      await connectToDatabase();
      await DashboardSessionModel.deleteOne({ tokenHash: hashToken(token) });
    } catch (error) {
      console.error("[session] Failed to delete session:", error);
    }
  }
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, "", { ...cookieOptions(new Date(0)), maxAge: 0 });
}

/** Revoke every session for a user (e.g. after a password change). */
export async function revokeAllSessionsForUser(
  userId: Types.ObjectId | string,
): Promise<number> {
  await connectToDatabase();
  const result = await DashboardSessionModel.deleteMany({ userId });
  return result.deletedCount ?? 0;
}

/** List a user's active sessions for the security settings page. */
export async function listActiveSessions(userId: Types.ObjectId | string) {
  await connectToDatabase();
  return DashboardSessionModel.find({
    userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .sort({ lastUsedAt: -1 })
    .lean();
}

/**
 * Guard for API routes: throws a 401 envelope the client can handle
 * uniformly instead of a redirect (redirects do not work in route handlers).
 */
export async function requireSessionUser(): Promise<DashboardSessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw ApiError.unauthorized("You must be signed in.", "UNAUTHORIZED");
  }
  return user;
}
