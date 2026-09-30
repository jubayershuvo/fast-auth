import "server-only";

import { Types } from "mongoose";

import { ApiError, ErrorCode } from "@/lib/errors";
import { env } from "@/lib/env";
import { connectToDatabase } from "@/lib/mongodb";
import { toObjectId } from "@/lib/authorization";
import { generateToken, hashToken } from "@/lib/tokens";
import { recordAuthEvent } from "@/lib/logger";
import { AuthAction } from "@/models/AuthLog";
import { AppUserModel } from "@/models/AppUser";
import { SessionModel, toPublicSession, type PublicSession } from "@/models/Session";
import type { PaginationInput } from "@/lib/validation";
import { searchAny } from "@/lib/search";

/**
 * End-user (application) session service.
 *
 * The customer's client calls:
 *   POST /api/v1/auth/login     -> { sessionToken }
 *   GET  /api/v1/auth/validate  Authorization: Bearer <sessionToken>
 *   POST /api/v1/auth/refresh   extend the session before it expires
 *   POST /api/v1/auth/logout
 *
 * Only the SHA-256 hash is stored, so a database leak yields no usable tokens.
 */

export type IssuedSession = {
  sessionToken: string;
  expiresAt: string;
};

/** Live (unrevoked, unexpired) sessions for one end user. */
export async function countActiveUserSessions(
  applicationId: Types.ObjectId,
  userId: Types.ObjectId,
): Promise<number> {
  await connectToDatabase();
  return SessionModel.countDocuments({
    applicationId,
    userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
}

/**
 * Refuse to mint a session past the per-user concurrent cap.
 *
 * Without this, `login` can be called in a loop to create unlimited session
 * rows. 0 (or negative) disables the cap for deployments that manage it
 * elsewhere.
 */
export async function assertSessionQuota(
  applicationId: Types.ObjectId,
  userId: Types.ObjectId,
): Promise<void> {
  const cap = env.maxSessionsPerUser;
  if (cap <= 0) return;

  const active = await countActiveUserSessions(applicationId, userId);
  if (active >= cap) {
    throw new ApiError(
      429,
      ErrorCode.TOO_MANY_SESSIONS,
      `Too many active sessions (${active}/${cap}). Sign out on another device first.`,
    );
  }
}

export async function createAppSession(params: {
  applicationId: Types.ObjectId;
  userId: Types.ObjectId;
  deviceId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<IssuedSession> {
  const sessionToken = generateToken();
  const expiresAt = new Date(Date.now() + env.appSessionTtlMs);

  await SessionModel.create({
    applicationId: params.applicationId,
    userId: params.userId,
    deviceId: params.deviceId,
    tokenHash: hashToken(sessionToken),
    expiresAt,
    revokedAt: null,
    lastUsedAt: new Date(),
    ip: params.ip ?? null,
    userAgent: params.userAgent ? params.userAgent.slice(0, 300) : null,
  });

  await recordAuthEvent({
    applicationId: params.applicationId,
    userId: params.userId,
    action: AuthAction.SESSION_CREATED,
    success: true,
    deviceId: params.deviceId,
    ip: params.ip ?? null,
  });

  return { sessionToken, expiresAt: expiresAt.toISOString() };
}

export type ResolvedSession = {
  sessionId: string;
  applicationId: Types.ObjectId;
  userId: Types.ObjectId;
  deviceId: string;
  username: string;
  expiresAt: Date;
};

/**
 * Resolve a bearer token to a live session.
 *
 * Checks in order: hash lookup -> not revoked -> not expired. Each failure has
 * its own error code so the client can distinguish "log in again" from
 * "this device was removed".
 */
export async function resolveAppSession(
  sessionToken: string,
  expectedApplicationId?: Types.ObjectId,
): Promise<ResolvedSession> {
  await connectToDatabase();

  const session = await SessionModel.findOne({
    tokenHash: hashToken(sessionToken),
  }).lean();

  if (!session) {
    throw ApiError.unauthorized("Invalid session token.", ErrorCode.UNAUTHORIZED);
  }
  if (session.revokedAt !== null) {
    throw new ApiError(401, ErrorCode.SESSION_REVOKED, "Session has been revoked.");
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(401, ErrorCode.SESSION_EXPIRED, "Session has expired.");
  }

  // Defence in depth: a token minted for another application must not work
  // here, even though the lookup is already unique by tokenHash.
  if (expectedApplicationId && !session.applicationId.equals(expectedApplicationId)) {
    throw ApiError.unauthorized("Invalid session token.", ErrorCode.UNAUTHORIZED);
  }

  const user = await AppUserModel.findById(session.userId).select("username").lean();
  if (!user) {
    throw ApiError.unauthorized("Invalid session token.", ErrorCode.UNAUTHORIZED);
  }

  // Non-blocking liveness update; failure must not fail the request.
  void SessionModel.updateOne(
    { _id: session._id },
    { $set: { lastUsedAt: new Date() } },
  ).catch(() => undefined);

  return {
    sessionId: session._id.toString(),
    applicationId: session.applicationId,
    userId: session.userId,
    deviceId: session.deviceId,
    username: user.username,
    expiresAt: session.expiresAt,
  };
}

/**
 * Extend a live session (sliding window).
 *
 * WHY THIS EXISTS: a session previously had a fixed 30-day life with no way to
 * extend it, so every end user had to re-enter their password monthly —
 * including the owner of the application, who has no self-service route. That
 * is not how an authenticator behaves.
 *
 * SECURITY — the token is NOT rotated. Rotation would force every client to
 * replace its credential atomically, and a client that fails midway is locked
 * out; for a bearer token kept only in memory by a game client, sliding the
 * same token is the better trade. The cost is that a stolen token stays valid,
 * which is bounded by two things: `appSessionMaxLifetimeMs` below, and the
 * fact that revocation (logout, ban, device removal) still kills it instantly.
 *
 * The renewed expiry is CLAMPED to `createdAt + maxLifetime`. Without the clamp
 * a client that renews before every expiry never has to authenticate again and
 * a stolen token becomes permanent — sliding expiry without a ceiling is a
 * silent session-lengthening vulnerability.
 *
 * Returns the NEW expiry. Callers must check the application's status before
 * calling this: a stopped app must not be renewable.
 */
export async function renewAppSession(
  sessionToken: string,
  applicationId?: Types.ObjectId,
): Promise<{ expiresAt: Date; userId: Types.ObjectId; deviceId: string }> {
  await connectToDatabase();

  const session = await SessionModel.findOne({
    tokenHash: hashToken(sessionToken),
  }).lean();

  if (!session) {
    throw ApiError.unauthorized("Invalid session token.", ErrorCode.UNAUTHORIZED);
  }
  if (session.revokedAt !== null) {
    throw new ApiError(401, ErrorCode.SESSION_REVOKED, "Session has been revoked.");
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    // Cannot revive a dead session — that would make "expired" meaningless and
    // turn any leaked old token into a permanent credential.
    throw new ApiError(401, ErrorCode.SESSION_EXPIRED, "Session has expired.");
  }
  if (applicationId && !session.applicationId.equals(applicationId)) {
    throw ApiError.unauthorized("Invalid session token.", ErrorCode.UNAUTHORIZED);
  }

  const now = Date.now();
  const ceiling = session.createdAt.getTime() + env.appSessionMaxLifetimeMs;
  const sliding = now + env.appSessionTtlMs;
  // Never shorten: if the ceiling is behind `now` the session simply keeps its
  // current expiry and the client is expected to log in again.
  const nextExpiresAt =
    sliding > ceiling ? new Date(Math.min(sliding, ceiling)) : session.expiresAt;

  // Conditional on the values we read, so two concurrent renewals cannot move
  // the expiry backwards.
  await SessionModel.updateOne(
    { _id: session._id, expiresAt: session.expiresAt },
    { $set: { expiresAt: nextExpiresAt, lastUsedAt: new Date() } },
  );

  await recordAuthEvent({
    applicationId: session.applicationId.toString(),
    userId: session.userId,
    action: AuthAction.SESSION_RENEWED,
    success: true,
    deviceId: session.deviceId,
    ip: session.ip,
  });

  return {
    expiresAt: nextExpiresAt,
    userId: session.userId,
    deviceId: session.deviceId,
  };
}

/**
 * Revoke every live session for a user EXCEPT the one presented.
 *
 * This is the "someone else has my account, lock them out" action. Keeping the
 * caller alive matters: revoking your own session here would log you out of the
 * very request you sent, which reads as a random failure.
 */
export async function revokeOtherUserSessions(
  applicationId: Types.ObjectId,
  userId: Types.ObjectId,
  keepSessionId: string,
): Promise<number> {
  await connectToDatabase();
  const result = await SessionModel.updateMany(
    {
      applicationId,
      userId,
      revokedAt: null,
      _id: { $ne: new Types.ObjectId(keepSessionId) },
    },
    { $set: { revokedAt: new Date() } },
  );
  return result.modifiedCount ?? 0;
}

/** Logout — revoke the presented session only. */
export async function revokeSessionByToken(
  sessionToken: string,
  applicationId?: Types.ObjectId,
): Promise<void> {
  await connectToDatabase();

  const filter: Record<string, unknown> = { tokenHash: hashToken(sessionToken) };
  if (applicationId) filter.applicationId = applicationId;

  const session = await SessionModel.findOneAndUpdate(
    filter,
    { $set: { revokedAt: new Date() } },
    { returnDocument: "after" },
  ).lean();

  if (session) {
    await recordAuthEvent({
      applicationId: session.applicationId,
      userId: session.userId,
      action: AuthAction.LOGOUT,
      success: true,
      deviceId: session.deviceId,
    });
  }
}

/** Owner-initiated revocation of every session for a user. */
export async function revokeAllAppSessions(
  applicationId: string,
  userId: string,
  reason = "REVOKED_BY_OWNER",
): Promise<number> {
  await connectToDatabase();
  const appObjectId = toObjectId(applicationId, "application id");
  const userObjectId = toObjectId(userId, "user id");

  const result = await SessionModel.updateMany(
    { applicationId: appObjectId, userId: userObjectId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );

  await recordAuthEvent({
    applicationId: appObjectId,
    userId: userObjectId,
    action: AuthAction.SESSION_REVOKED,
    success: true,
    reason,
  });

  return result.modifiedCount ?? 0;
}

/** Revoke every session issued on one device. */
export async function revokeSessionsForDevice(
  applicationId: string,
  userId: string,
  deviceId: string,
): Promise<number> {
  await connectToDatabase();
  const result = await SessionModel.updateMany(
    {
      applicationId: toObjectId(applicationId, "application id"),
      userId: toObjectId(userId, "user id"),
      deviceId,
      revokedAt: null,
    },
    { $set: { revokedAt: new Date() } },
  );
  return result.modifiedCount ?? 0;
}

/** Owner-facing session list. */
export async function listAppSessions(
  applicationId: string,
  options: PaginationInput & { userId?: string; search?: string },
): Promise<{ sessions: PublicSession[]; total: number }> {
  await connectToDatabase();
  const filter: Record<string, unknown> = {
    applicationId: toObjectId(applicationId, "application id"),
  };
  if (options.userId) filter.userId = toObjectId(options.userId, "user id");
  // Searched in the query so the total reflects the filter, not just the page.
  const matches = searchAny(options.search, [
    "deviceId", "deviceName", "platform", "ip", "userAgent",
  ]);
  if (matches) filter.$or = matches;

  const skip = (options.page - 1) * options.limit;
  const [sessions, total] = await Promise.all([
    SessionModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(options.limit).lean(),
    SessionModel.countDocuments(filter),
  ]);

  return { sessions: sessions.map(toPublicSession), total };
}
