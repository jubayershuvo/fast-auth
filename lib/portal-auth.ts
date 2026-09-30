import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Types } from "mongoose";

import { env } from "@/lib/env";
import { ApiError } from "@/lib/errors";
import { connectToDatabase } from "@/lib/mongodb";
import { generateToken, hashToken } from "@/lib/tokens";
import { isExpired, AppUserModel } from "@/models/AppUser";
import { SessionModel } from "@/models/Session";

/**
 * Self-service portal — a signed-in APPLICATION END USER.
 *
 * This is a fifth, entirely separate credential realm, and the distinction
 * matters:
 *
 *   end user (v1)  -> Bearer token, presented by the CUSTOMER's own client
 *   end user (here)-> httpOnly cookie, presented by a PERSON in a browser
 *
 * Why a new realm rather than reusing the bearer token: a bearer token lives in
 * the customer's client, which may be a game on a TV box. A person on a website
 * needs the protections a cookie gives (httpOnly so XSS cannot steal it,
 * SameSite=Lax so it is not attached to cross-site POSTs). Reusing the token
 * would mean putting a long-lived secret in exactly the place it is most
 * exposed.
 *
 * WHY THE `Session` MODEL IS REUSED ANYWAY — this is the important part.
 * The portal session is the SAME `sessions` row an end-user login creates, not
 * a parallel collection. That means every existing owner control keeps working
 * against portal sessions with no extra code: banning a user, changing their
 * password, or revoking their sessions all reach the browser exactly as they
 * reach the game client. A second session store would have meant two places for
 * a ban to be honoured, and eventually one that was forgotten.
 *
 * It is marked by `PORTAL_DEVICE_ID`. A portal session is not tied to a real
 * client device and must NOT consume a licence seat: seat accounting reads the
 * `devices` collection, so nothing here appears there.
 */

/** Cookie name. Distinct from `fa_session` and `fa_admin_session` on purpose. */
export const PORTAL_COOKIE_NAME = "fa_app_session";

/**
 * The `deviceId` recorded on a portal session.
 *
 * A real client supplies an 8–128 char HWID; a browser has none. This sentinel
 * is deliberately not a shape a client could produce, so the two can never be
 * confused in a per-device revocation.
 */
export const PORTAL_DEVICE_ID = "__portal__";

export type PortalUser = {
  id: string;
  applicationId: string;
  username: string;
  name: string;
  expiresAt: Date | null;
  isExpired: boolean;
  isBanned: boolean;
  maxDevices: number;
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

/**
 * Mint a portal session and set the cookie.
 *
 * Skips `assertSessionQuota` deliberately: the cap exists so a client cannot loop
 * `login` to manufacture unbounded session rows, and the portal already demands
 * real credentials to reach. It still records a row, so the session is visible
 * to the owner in the existing session list and dies on the same revocation
 * paths.
 */
export async function createPortalSession(
  applicationId: Types.ObjectId,
  userId: Types.ObjectId,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ expiresAt: Date }> {
  await connectToDatabase();

  const token = generateToken();
  const expiresAt = new Date(Date.now() + env.appSessionTtlMs);

  await SessionModel.create({
    applicationId,
    userId,
    deviceId: PORTAL_DEVICE_ID,
    tokenHash: hashToken(token),
    expiresAt,
    revokedAt: null,
    lastUsedAt: new Date(),
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ? meta.userAgent.slice(0, 300) : null,
  });

  const store = await cookies();
  store.set(PORTAL_COOKIE_NAME, token, cookieOptions(expiresAt));

  return { expiresAt };
}

export async function readPortalToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(PORTAL_COOKIE_NAME)?.value ?? null;
}

/**
 * Resolve the cookie to a live end user, or null.
 *
 * Null for EVERY failure — missing, unknown, expired, revoked, deleted, banned
 * or expired ACCOUNT — so callers have one check.
 *
 * The ban and account-expiry checks are re-read on every request rather than
 * trusted from sign-in time. A cookie outlives the state that justified it: an
 * operator who bans a user must take effect immediately, not whenever that
 * browser's cookie happens to expire.
 */
export async function getPortalUser(): Promise<PortalUser | null> {
  const token = await readPortalToken();
  if (!token) return null;

  await connectToDatabase();

  const session = await SessionModel.findOne({
    tokenHash: hashToken(token),
    deviceId: PORTAL_DEVICE_ID,
  }).lean();

  if (!session) return null;
  if (session.revokedAt !== null) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  const user = await AppUserModel.findOne({
    _id: session.userId,
    // The tenancy boundary, re-asserted on every read. A session row alone is
    // not proof the two still belong together.
    applicationId: session.applicationId,
  }).lean();

  if (!user) return null;
  if (user.isBanned) return null;
  if (isExpired(user.expiresAt)) return null;

  // Fire-and-forget activity timestamp; never block the request on it.
  void SessionModel.updateOne(
    { _id: session._id },
    { $set: { lastUsedAt: new Date() } },
  ).catch(() => undefined);

  return {
    id: user._id.toString(),
    applicationId: user.applicationId.toString(),
    username: user.username,
    name: user.name?.trim() || user.username,
    expiresAt: user.expiresAt,
    isExpired: false,
    isBanned: false,
    maxDevices: user.maxDevices,
  };
}

/**
 * Resolve the cookie to a live end user OF THIS APPLICATION, or null.
 *
 * This is the guard that per-application URLs make necessary. The cookie says
 * WHO and WHICH APP; the URL says WHICH APP was asked for. Without this
 * comparison, signing in to app A and then editing `/apps/<appB>/dashboard`
 * would render app A's account under app B's name — one shared cookie silently
 * spanning every tenant, which is precisely the boundary this whole system is
 * built to hold.
 *
 * The mismatch resolves to `null` (i.e. "not signed in"), not to a distinct
 * error: there is nothing useful to tell a caller who is simply signed in
 * somewhere else, and no reason to confirm that app B exists.
 */
export async function getPortalUserForApp(
  applicationObjectId: string,
): Promise<PortalUser | null> {
  const user = await getPortalUser();
  if (!user) return null;
  if (user.applicationId !== applicationObjectId) return null;
  return user;
}

/** Guard for API routes: a 401 envelope rather than a redirect. */
export async function requirePortalUser(): Promise<PortalUser> {
  const user = await getPortalUser();
  if (!user) {
    throw ApiError.unauthorized("You must be signed in.", "UNAUTHORIZED");
  }
  return user;
}

/**
 * Page-level variant. Server components cannot render a JSON envelope, so an
 * anonymous visitor is redirected to the portal sign-in screen instead.
 *
 * The redirect keeps the person on the SAME application's sign-in page, since
 * that is the only place they can authenticate for it.
 */
export async function requirePortalUserPage(
  applicationObjectId: string,
  appId: string,
): Promise<PortalUser> {
  const user = await getPortalUserForApp(applicationObjectId);
  if (!user) {
    redirect(`/apps/${encodeURIComponent(appId)}/login`);
  }
  return user;
}

/** Revoke the presented portal session and clear the cookie. Idempotent. */
export async function destroyPortalSession(): Promise<void> {
  const token = await readPortalToken();
  if (token) {
    try {
      await connectToDatabase();
      await SessionModel.deleteOne({
        tokenHash: hashToken(token),
        deviceId: PORTAL_DEVICE_ID,
      });
    } catch (error) {
      console.error("[portal] Failed to delete session:", error);
    }
  }
  const store = await cookies();
  store.set(PORTAL_COOKIE_NAME, "", {
    ...cookieOptions(new Date(0)),
    maxAge: 0,
  });
}