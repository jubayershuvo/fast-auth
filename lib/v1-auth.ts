import "server-only";

import { ApiError, ErrorCode } from "@/lib/errors";
import { env } from "@/lib/env";
import { fakeVerifyDelay, verifyPassword } from "@/lib/password";
import { checkRateLimit, consumeRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { Types } from "mongoose";

import { recordAuthEvent } from "@/lib/logger";
import { describePlatform, getRequestContext } from "@/lib/request";
import { findApplicationByAppId, verifyAppSecret } from "@/lib/application";
import { createAppSession, resolveAppSession, revokeSessionByToken, renewAppSession, revokeOtherUserSessions, assertSessionQuota } from "@/lib/app-session";
import { registerDevice } from "@/lib/device";
import { hashPassword } from "@/lib/password";
import { AppUserModel, isExpired } from "@/models/AppUser";
import { AuthAction } from "@/models/AuthLog";
import { SessionModel, toPublicSession, type PublicSession } from "@/models/Session";
import type { V1LoginInput } from "@/lib/validation";
import { appIdSchema } from "@/lib/validation";

/**
 * Public authentication service used by /api/v1/auth/*.
 *
 * LOGIN PIPELINE (order matters — cheap checks first, bcrypt late, so a flood
 * of requests against banned/expired accounts cannot cost a password hash):
 *
 *   1. rate limit
 *   2. resolve application by public appId
 *   3. verify optional app secret
 *   4. load application user (scoped to that application)
 *   5. verify password           <- bcrypt
 *   6. reject if banned
 *   7. reject if expired
 *   8. register/refresh device, enforcing maxDevices
 *   9. issue session
 *  10. write audit log
 *
 * Every failure path writes an AuthLog entry so the owner can see attempts.
 */

export type LoginSuccess = {
  sessionToken: string;
  expiresAt: string;
  user: {
    username: string;
    deviceId: string;
    devicesUsed: number;
    maxDevices: number;
    isNewDevice: boolean;
  };
};

/** Extract `Authorization: Bearer <token>`. Returns null when absent/other. */
export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * The header every /api/v1 endpoint identifies the application with.
 *
 * `appId` used to travel three different ways across four routes — JSON body on
 * login/logout, query string on validate/me. That made every client guess, and
 * made a body/query appId silently disagree with the bearer token. One header,
 * one place, for all of them.
 */
export const APP_ID_HEADER = "X-App-Id";

/**
 * Read and validate the application id from the `X-App-Id` header.
 *
 * Missing and malformed are reported separately: a client that never sends the
 * header has a wiring bug, while one that sends a wrong-shaped value usually
 * means it is still using the old body/query field and should be told so.
 */
export function requireAppIdHeader(request: Request): string {
  const raw = request.headers.get(APP_ID_HEADER);

  if (raw === null || raw.trim() === "") {
    throw ApiError.validation(
      `Missing ${APP_ID_HEADER} header. The application id is no longer accepted in the body or query string.`,
    );
  }

  const parsed = appIdSchema.safeParse(raw);
  if (!parsed.success) {
    throw ApiError.validation(
      `Invalid ${APP_ID_HEADER} header. Expected the public application id, e.g. fa_AbCdEfGhIjKlMnOp.`,
    );
  }
  return parsed.data;
}

/** Optional variant, for endpoints that work without an app scope. */
export function readAppIdHeader(request: Request): string | null {
  const raw = request.headers.get(APP_ID_HEADER);
  if (raw === null || raw.trim() === "") return null;
  const parsed = appIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Refuse every /api/v1 authentication call while the owner has the app stopped.
 *
 * 503, not 401/403: the credentials are not wrong and the user is not banned —
 * the service is switched off. A client that treats this as "bad credentials"
 * will lock the user out of the app itself by deleting a perfectly good token,
 * which is exactly what you do NOT want from a temporary pause.
 *
 * Applied to BOTH login and session validation. Gating only login would look
 * like it worked while every already-logged-in user sailed through — a stopped
 * app that keeps serving live sessions is not stopped.
 */
export function assertApplicationActive(
  application: { status?: string | null },
): void {
  // Defaulted to active: documents predating the `status` field have no value,
  // and reading that as suspended would break every existing app on upgrade.
  if ((application.status ?? "active") === "suspended") {
    throw new ApiError(
      503,
      ErrorCode.APP_SUSPENDED,
      "This application is temporarily stopped. Please try again later.",
    );
  }
}

export async function loginToApplication(
  input: V1LoginInput & { appId: string },
  request: Request,
): Promise<LoginSuccess> {
  const { ip, userAgent } = getRequestContext(request);
  const platform = describePlatform(userAgent);

  // 1. Rate limit per appId + ip + username.
  const limitKey = `v1-login:${input.appId}:${ip ?? "unknown"}:${input.username}`;
  const max = env.loginRateLimitMax;
  const windowMs = env.loginRateLimitWindowMs;
  const limit = checkRateLimit(limitKey, max);
  if (!limit.allowed) {
    throw ApiError.rateLimited("Too many login attempts. Please try again later.");
  }
  consumeRateLimit(limitKey, max, windowMs);

  // 2. Resolve the application.
  const application = await findApplicationByAppId(input.appId);
  if (!application) {
    // No application to log against; the limiter above still throttles
    // enumeration of appId values.
    throw new ApiError(404, ErrorCode.INVALID_APPLICATION, "Invalid application.");
  }

  const applicationObjectId = application._id as Types.ObjectId;

  // 2b. Owner pressed Stop. Checked BEFORE the bcrypt step, so a stopped app
  //     costs no password hashing and — more importantly — never confirms
  //     whether a given password was correct.
  assertApplicationActive(application);

  // 3. Optional app-level secret (second factor for the whole application).
  if (input.appSecret !== undefined) {
    await verifyAppSecret(application, input.appSecret);
  }

  // 4. Load the user WITHIN this application only — the isolation boundary.
  //    The same username in another app is a completely different account.
  const user = await AppUserModel.findOne({
    applicationId: applicationObjectId,
    username: input.username,
  })
    .select("+passwordHash")
    .lean();

  if (!user) {
    await fakeVerifyDelay();
    throw new ApiError(401, ErrorCode.INVALID_CREDENTIALS, "Invalid credentials.");
  }

  // 5. Password verification.
  const passwordValid = await verifyPassword(input.password, user.passwordHash);
  if (!passwordValid) {
    await recordAuthEvent({
      applicationId: applicationObjectId,
      userId: user._id,
      username: user.username,
      action: AuthAction.LOGIN_FAILED,
      success: false,
      reason: ErrorCode.INVALID_CREDENTIALS,
      ip,
      deviceId: input.deviceId,
    });
    throw new ApiError(401, ErrorCode.INVALID_CREDENTIALS, "Invalid credentials.");
  }

  // 6. Ban check — before device registration, so a banned user cannot
  //    consume a device seat.
  if (user.isBanned) {
    await recordAuthEvent({
      applicationId: applicationObjectId,
      userId: user._id,
      username: user.username,
      action: AuthAction.ACCOUNT_BANNED,
      success: false,
      reason: user.banReason ?? "BANNED",
      ip,
      deviceId: input.deviceId,
    });
    throw new ApiError(403, ErrorCode.ACCOUNT_BANNED, "This account has been banned.");
  }

  // 7. Expiry check against a real absolute date.
  if (isExpired(user.expiresAt)) {
    await recordAuthEvent({
      applicationId: applicationObjectId,
      userId: user._id,
      username: user.username,
      action: AuthAction.ACCOUNT_EXPIRED,
      success: false,
      reason: ErrorCode.ACCOUNT_EXPIRED,
      ip,
      deviceId: input.deviceId,
    });
    throw new ApiError(403, ErrorCode.ACCOUNT_EXPIRED, "Account has expired.");
  }

  // 8. Device registration (enforces maxDevices).
  let registration: Awaited<ReturnType<typeof registerDevice>>;
  try {
    registration = await registerDevice({
      applicationId: applicationObjectId,
      userId: user._id as Types.ObjectId,
      deviceId: input.deviceId,
      deviceName: input.deviceName ?? null,
      ip,
      userAgent,
      platform,
    });
  } catch (error) {
    await recordAuthEvent({
      applicationId: applicationObjectId,
      userId: user._id,
      username: user.username,
      action: AuthAction.LOGIN_FAILED,
      success: false,
      reason: ErrorCode.DEVICE_LIMIT_REACHED,
      ip,
      deviceId: input.deviceId,
    });
    throw error;
  }

  // 9. Issue a session.
  // Capped per user: without this, login can be called in a loop to create
  // unlimited session rows. Checked here rather than inside createAppSession so
  // it sits with the rest of the login pipeline's failure paths.
  await assertSessionQuota(applicationObjectId, user._id as Types.ObjectId);

  const session = await createAppSession({
    applicationId: applicationObjectId,
    userId: user._id as Types.ObjectId,
    deviceId: input.deviceId,
    ip,
    userAgent,
  });

  // Clear the throttle bucket so a legitimate user is not penalised later.
  resetRateLimit(limitKey);

  // 10. Success audit + liveness timestamp.
  await recordAuthEvent({
    applicationId: applicationObjectId,
    userId: user._id,
    username: user.username,
    action: AuthAction.LOGIN_SUCCESS,
    success: true,
    ip,
    deviceId: input.deviceId,
  });

  await AppUserModel.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

  return {
    sessionToken: session.sessionToken,
    expiresAt: session.expiresAt,
    user: {
      username: user.username,
      deviceId: input.deviceId,
      devicesUsed: registration.devicesUsed,
      maxDevices: registration.maxDevices,
      isNewDevice: registration.status === "registered",
    },
  };
}

export type ValidateResult = {
  valid: true;
  username: string;
  deviceId: string;
  expiresAt: string;
};

/**
 * Resolve the application for a v1 request and assert it is running.
 *
 * Shared by the self-service routes so each one cannot forget the Stop check.
 * A route that skipped it would be a trivial way to keep a stopped app alive.
 */
async function requireRunningApplication(
  appId: string,
): Promise<Types.ObjectId> {
  const application = await findApplicationByAppId(appId);
  if (!application) {
    throw new ApiError(404, ErrorCode.INVALID_APPLICATION, "Invalid application.");
  }
  assertApplicationActive(application);
  return application._id as Types.ObjectId;
}

/**
 * Extend the caller's session (sliding window).
 *
 * Rejects an already-expired session rather than reviving it — otherwise any
 * leaked long-dead token becomes a permanent credential.
 */
export async function refreshSession(
  request: Request,
  appId: string,
): Promise<{ expiresAt: string }> {
  const token = extractBearerToken(request);
  if (!token) {
    throw ApiError.unauthorized("Missing bearer token.", ErrorCode.UNAUTHORIZED);
  }

  const applicationObjectId = await requireRunningApplication(appId);
  const { expiresAt } = await renewAppSession(token, applicationObjectId);
  return { expiresAt: expiresAt.toISOString() };
}

/** The caller's own live sessions, most recently used first. Never another's. */
export async function listOwnSessions(
  request: Request,
  appId: string,
): Promise<{ sessions: PublicSession[]; currentSessionId: string }> {
  const token = extractBearerToken(request);
  if (!token) {
    throw ApiError.unauthorized("Missing bearer token.", ErrorCode.UNAUTHORIZED);
  }

  const applicationObjectId = await requireRunningApplication(appId);
  const session = await resolveAppSession(token, applicationObjectId);

  const rows = await SessionModel.find({
    applicationId: applicationObjectId,
    userId: session.userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .sort({ lastUsedAt: -1 })
    .lean();

  return { sessions: rows.map(toPublicSession), currentSessionId: session.sessionId };
}

/** Revoke every live session for the caller except the one they are using. */
export async function revokeOwnOtherSessions(
  request: Request,
  appId: string,
): Promise<{ revoked: number }> {
  const token = extractBearerToken(request);
  if (!token) {
    throw ApiError.unauthorized("Missing bearer token.", ErrorCode.UNAUTHORIZED);
  }

  const applicationObjectId = await requireRunningApplication(appId);
  const session = await resolveAppSession(token, applicationObjectId);
  const revoked = await revokeOtherUserSessions(
    applicationObjectId,
    session.userId,
    session.sessionId,
  );

  await recordAuthEvent({
    applicationId: applicationObjectId,
    userId: session.userId,
    username: session.username,
    action: AuthAction.SESSION_REVOKED,
    success: true,
    reason: "REVOKE_OTHERS",
  });

  return { revoked };
}

/**
 * Change the caller's own password.
 *
 * Self-service was missing entirely: an end user who suspected compromise could
 * only ask the application owner to reset it from the dashboard, so a customer
 * with an unresponsive owner had no way out.
 *
 * Requires the CURRENT password even though the caller already holds a valid
 * session — that step-up check is what stops a stolen session (found by
 * malware, say) from taking the account over permanently.
 *
 * Every OTHER session is revoked, so a stolen token dies the moment the real
 * user changes their password. The caller's own session survives, otherwise
 * they would be logged out of the very request they sent.
 */
export async function changeOwnPassword(
  request: Request,
  appId: string,
  input: { currentPassword: string; newPassword: string },
): Promise<{ revokedSessions: number }> {
  const token = extractBearerToken(request);
  if (!token) {
    throw ApiError.unauthorized("Missing bearer token.", ErrorCode.UNAUTHORIZED);
  }

  const applicationObjectId = await requireRunningApplication(appId);
  const session = await resolveAppSession(token, applicationObjectId);

  const user = await AppUserModel.findOne({
    _id: session.userId,
    applicationId: applicationObjectId,
  })
    .select("+passwordHash")
    .lean();

  if (!user) {
    throw new ApiError(404, ErrorCode.USER_NOT_FOUND, "User not found.");
  }

  const currentValid = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!currentValid) {
    await recordAuthEvent({
      applicationId: applicationObjectId,
      userId: user._id,
      username: user.username,
      action: AuthAction.PASSWORD_RESET,
      success: false,
      reason: ErrorCode.CURRENT_PASSWORD_INCORRECT,
    });
    throw new ApiError(
      401,
      ErrorCode.CURRENT_PASSWORD_INCORRECT,
      "Your current password is incorrect.",
    );
  }

  // Refuse a no-op change rather than silently re-hashing the same secret and
  // reporting success, which would make the user think they secured something.
  const unchanged = await verifyPassword(input.newPassword, user.passwordHash);
  if (unchanged) {
    throw new ApiError(
      400,
      ErrorCode.PASSWORD_UNCHANGED,
      "The new password must be different from the current one.",
    );
  }

  await AppUserModel.updateOne(
    { _id: user._id, applicationId: applicationObjectId },
    { $set: { passwordHash: await hashPassword(input.newPassword) } },
  );

  // Flagged, not deleted — the client should see SESSION_REVOKED.
  const result = await SessionModel.updateMany(
    {
      applicationId: applicationObjectId,
      userId: user._id,
      revokedAt: null,
      _id: { $ne: new Types.ObjectId(session.sessionId) },
    },
    { $set: { revokedAt: new Date() } },
  );

  await recordAuthEvent({
    applicationId: applicationObjectId,
    userId: user._id,
    username: user.username,
    action: AuthAction.PASSWORD_RESET,
    success: true,
  });

  return { revokedSessions: result.modifiedCount ?? 0 };
}

/** Validate a bearer token for a customer's in-game request. */
export async function validateSession(
  request: Request,
  appId?: string,
  deviceId?: string,
): Promise<ValidateResult> {
  const token = extractBearerToken(request);
  if (!token) {
    throw ApiError.unauthorized("Missing bearer token.", ErrorCode.UNAUTHORIZED);
  }

  // When the client states which app it belongs to, enforce the match.
  let expected: Types.ObjectId | undefined;
  if (appId) {
    const application = await findApplicationByAppId(appId);
    if (!application) {
      throw new ApiError(404, ErrorCode.INVALID_APPLICATION, "Invalid application.");
    }
    // A token that was perfectly valid a second ago must stop working the moment
    // the owner presses Stop. Without this, "Stop" would only affect future
    // logins and every existing session would keep being served.
    assertApplicationActive(application);
    expected = application._id as Types.ObjectId;
  }

  const session = await resolveAppSession(token, expected);

  // Optional device pinning: lets a client require that the token was issued
  // to the same device it is currently running on.
  if (deviceId && session.deviceId !== deviceId) {
    throw new ApiError(
      403,
      ErrorCode.DEVICE_MISMATCH,
      "Session was issued for a different device.",
    );
  }

  return {
    valid: true,
    username: session.username,
    deviceId: session.deviceId,
    expiresAt: session.expiresAt.toISOString(),
  };
}

/** Logout — revoke the presented token. Idempotent by design. */
export async function logoutFromApplication(request: Request, appId?: string): Promise<void> {
  const token = extractBearerToken(request);
  if (!token) {
    throw ApiError.unauthorized("Missing bearer token.", ErrorCode.UNAUTHORIZED);
  }

  let expected: Types.ObjectId | undefined;
  if (appId) {
    const application = await findApplicationByAppId(appId);
    if (application) expected = application._id as Types.ObjectId;
  }

  await revokeSessionByToken(token, expected);
}
