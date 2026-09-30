import "server-only";

import { cookies } from "next/headers";
import type { Types } from "mongoose";

import { env } from "@/lib/env";
import { ApiError } from "@/lib/errors";
import { connectToDatabase } from "@/lib/mongodb";
import { generateToken, hashToken } from "@/lib/tokens";
import { AdminSessionModel } from "@/models/AdminSession";
import { AdminUserModel } from "@/models/AdminUser";

/**
 * Platform-admin session management.
 *
 * Mirrors `lib/session.ts` (customer sessions) but over a SEPARATE cookie
 * namespace. The two are never interchangeable, so a stolen customer cookie
 * grants nothing here and vice versa.
 */

export const ADMIN_SESSION_COOKIE_NAME = "fa_admin_session";

export type AdminIdentity = {
  id: string;
  email: string;
  username: string;
};

function adminCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    // `strict` (not `lax`): an admin session should never ride along on a
    // top-level cross-site navigation, so it is only sent on same-site use.
    sameSite: "strict" as const,
    // MUST be "/". The admin realm spans two URL families — the pages at
    // /admin/* and the JSON API at /api/admin/* — and a cookie is only sent
    // when the request path starts with its Path. "/admin" therefore looks
    // correct on the settings page but silently drops the cookie on every
    // /api/admin call, which fails as "Administrator sign-in required" while
    // the user is visibly signed in. The only prefix covering both is "/".
    //
    // Cross-realm isolation does NOT depend on this path: it comes from the
    // unique cookie name, httpOnly, and sameSite=strict. A narrow path is not
    // a security boundary here, and pretending otherwise caused this bug.
    path: "/",
    expires: expiresAt,
  };
}

export async function createAdminSession(
  adminId: Types.ObjectId | string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ expiresAt: Date }> {
  await connectToDatabase();

  const token = generateToken();
  const expiresAt = new Date(Date.now() + env.adminSessionTtlMs);

  await AdminSessionModel.create({
    adminId,
    tokenHash: hashToken(token),
    expiresAt,
    revokedAt: null,
    lastUsedAt: new Date(),
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ? meta.userAgent.slice(0, 300) : null,
  });

  const store = await cookies();
  store.set(ADMIN_SESSION_COOKIE_NAME, token, adminCookieOptions(expiresAt));
  return { expiresAt };
}

export async function readAdminSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(ADMIN_SESSION_COOKIE_NAME)?.value ?? null;
}

/**
 * Every admin session token this browser presents, across cookie paths.
 *
 * The cookie used to be issued with `Path=/admin`, then moved to `Path=/` so it
 * would also reach `/api/admin/*`. A browser keys cookies by
 * (name, domain, path), so that change did NOT replace the old cookie — it
 * created a SECOND one, still holding its own live session token.
 *
 * We deliberately do not try to expire the old copy by name. Next.js keys its
 * outgoing Set-Cookie headers by NAME only, so a response carrying both
 * `fa_admin_session=…; Path=/` and `fa_admin_session=; Path=/admin` emits just
 * one header — verified to silently drop the live session and bounce the
 * operator straight back to the sign-in page.
 *
 * Revoking every presented token is what actually neutralises the leftover.
 */
export async function readAllAdminSessionTokens(): Promise<string[]> {
  const store = await cookies();
  const all = store.getAll(ADMIN_SESSION_COOKIE_NAME);
  const values = all.map((cookie) => cookie.value).filter(Boolean);
  // Some runtimes return getAll() unfiltered; de-duplicate defensively.
  return [...new Set(values)];
}

/**
 * Resolve the admin cookie to an identity, or null.
 * Returns null for every failure mode so callers have one simple check.
 * ALWAYS hits the database — this is the authoritative check, not the proxy's.
 */
export async function getAdminIdentity(): Promise<AdminIdentity | null> {
  const token = await readAdminSessionToken();
  if (!token) return null;

  await connectToDatabase();
  const session = await AdminSessionModel.findOne({
    tokenHash: hashToken(token),
  }).lean();

  if (!session) return null;
  if (session.revokedAt !== null) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  const admin = await AdminUserModel.findById(session.adminId).lean();
  if (!admin) return null;

  void AdminSessionModel.updateOne(
    { _id: session._id },
    { $set: { lastUsedAt: new Date() } },
  ).catch(() => undefined);

  return {
    id: admin._id.toString(),
    email: admin.email,
    username: admin.username,
  };
}

export async function destroyAdminSession(): Promise<void> {
  // Revoke EVERY session this browser presents, not just the first cookie.
  // A leftover Path=/admin copy from before the cookie fix would otherwise keep
  // granting access after the operator believed they had signed out.
  const tokens = await readAllAdminSessionTokens();
  if (tokens.length > 0) {
    try {
      await connectToDatabase();
      await AdminSessionModel.deleteMany({
        tokenHash: { $in: tokens.map((token) => hashToken(token)) },
      });
    } catch (error) {
      console.error("[admin-session] Failed to delete session:", error);
    }
  }
  const store = await cookies();
  store.set(ADMIN_SESSION_COOKIE_NAME, "", {
    ...adminCookieOptions(new Date(0)),
    maxAge: 0,
  });
}

/** Revoke every admin session for an identity (e.g. after a password change). */
export async function revokeAllAdminSessions(
  adminId: Types.ObjectId | string,
): Promise<number> {
  await connectToDatabase();
  const result = await AdminSessionModel.deleteMany({ adminId });
  return result.deletedCount ?? 0;
}

/** Guard for API routes. */
export async function requireAdminIdentity(): Promise<AdminIdentity> {
  const admin = await getAdminIdentity();
  if (!admin) {
    throw ApiError.unauthorized("Administrator sign-in required.", "UNAUTHORIZED");
  }
  return admin;
}
