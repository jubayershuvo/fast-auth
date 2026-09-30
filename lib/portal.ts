import "server-only";

import { Types } from "mongoose";

import { ApiError, ErrorCode } from "@/lib/errors";
import { env } from "@/lib/env";
import { connectToDatabase } from "@/lib/mongodb";
import { getRequestContext } from "@/lib/request";
import { checkRateLimit, consumeRateLimit } from "@/lib/rate-limit";
import { fakeVerifyDelay, hashPassword, verifyPassword } from "@/lib/password";
import { findApplicationByAppId } from "@/lib/application";
import { assertApplicationActive } from "@/lib/v1-auth";
import { recordAuthEvent } from "@/lib/logger";
import { AuthAction } from "@/models/AuthLog";
import { AppUserModel, isExpired } from "@/models/AppUser";
import { DeviceModel, toPublicDevice } from "@/models/Device";
import { SessionModel } from "@/models/Session";
import { createPortalSession, PORTAL_DEVICE_ID } from "@/lib/portal-auth";
import type {
  PortalLoginInput,
  PortalUpdateProfileInput,
} from "@/lib/validation";

/**
 * Portal business logic — what an end user can do to their OWN account.
 *
 * The tenancy rule is enforced identically to every other realm: the target is
 * always reached through `applicationId` + `userId` that came out of the
 * SESSION, never from a request body or a path. There is no endpoint here that
 * accepts an id, which is why there is no IDOR to get wrong in this file.
 */

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

/**
 * Sign an end user in from a browser and open a portal session.
 *
 * Deliberately mirrors `loginToApplication` step for step — rate limit,
 * application resolution, stop check, password, ban, expiry — so a person in a
 * browser is refused exactly when their game client would be. The two
 * differences are intentional:
 *
 *   - NO `appSecret`. That is the customer's backend second factor; a person
 *     typing into a web form must never be asked for it, and accepting it here
 *     would hand the app-wide secret to every end user.
 *   - NO device registration. A browser has no HWID, and manufacturing one here
 *     would burn a licence seat on the very act of visiting a web page.
 */
export async function portalLogin(input: PortalLoginInput, request: Request) {
  const { ip, userAgent } = getRequestContext(request);

  const limitKey = `portal-login:${input.appId}:${ip ?? "unknown"}:${input.username}`;
  const max = env.loginRateLimitMax;
  const windowMs = env.loginRateLimitWindowMs;
  if (!checkRateLimit(limitKey, max).allowed) {
    throw ApiError.rateLimited("Too many login attempts. Please try again later.");
  }
  consumeRateLimit(limitKey, max, windowMs);

  const application = await findApplicationByAppId(input.appId);
  if (!application) {
    // The limiter above still throttles enumeration of appId values.
    throw new ApiError(404, ErrorCode.INVALID_APPLICATION, "Invalid application.");
  }
  const applicationObjectId = application._id as Types.ObjectId;

  // Owner pressed Stop — before the bcrypt step, so a stopped app costs no
  // hashing and never confirms whether a password was right.
  assertApplicationActive(application);

  // The username is unique only WITHIN an application: this is the boundary.
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
      deviceId: PORTAL_DEVICE_ID,
    });
    throw new ApiError(401, ErrorCode.INVALID_CREDENTIALS, "Invalid credentials.");
  }

  if (user.isBanned) {
    await recordAuthEvent({
      applicationId: applicationObjectId,
      userId: user._id,
      username: user.username,
      action: AuthAction.ACCOUNT_BANNED,
      success: false,
      reason: user.banReason ?? ErrorCode.ACCOUNT_BANNED,
      ip,
      deviceId: PORTAL_DEVICE_ID,
    });
    throw new ApiError(
      403,
      ErrorCode.ACCOUNT_BANNED,
      user.banReason
        ? `This account is suspended: ${user.banReason}`
        : "This account is suspended.",
    );
  }

  if (isExpired(user.expiresAt)) {
    await recordAuthEvent({
      applicationId: applicationObjectId,
      userId: user._id,
      username: user.username,
      action: AuthAction.ACCOUNT_EXPIRED,
      success: false,
      reason: ErrorCode.ACCOUNT_EXPIRED,
      ip,
      deviceId: PORTAL_DEVICE_ID,
    });
    throw new ApiError(
      403,
      ErrorCode.ACCOUNT_EXPIRED,
      "This account has expired. Contact the application's owner to renew it.",
    );
  }

  await recordAuthEvent({
    applicationId: applicationObjectId,
    userId: user._id,
    username: user.username,
    action: AuthAction.LOGIN_SUCCESS,
    success: true,
    ip,
    deviceId: PORTAL_DEVICE_ID,
  });

  const { expiresAt } = await createPortalSession(applicationObjectId, user._id, {
    ip,
    userAgent,
  });

  return {
    user: {
      id: user._id.toString(),
      username: user.username,
      name: user.name?.trim() || user.username,
    },
    applicationName: application.name,
    expiresAt: expiresAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/**
 * What the portal shows about the signed-in user. Never includes a hash.
 *
 * `notes` is deliberately reported as a constant `null` rather than read: notes
 * are the OWNER's private remarks about a customer, and an end user has no
 * business seeing them. Returning null documents that intent without leaking.
 */
export async function getPortalProfile(userId: string, applicationId: string) {
  await connectToDatabase();

  const user = await AppUserModel.findOne({
    _id: toObjectId(userId, "user id"),
    applicationId: toObjectId(applicationId, "application id"),
  }).lean();
  if (!user) throw ApiError.notFound("Account not found.");

  const application = await findApplicationName(applicationId);
  const devicesUsed = await DeviceModel.countDocuments({
    applicationId: user.applicationId,
    userId: user._id,
  });

  return {
    id: user._id.toString(),
    username: user.username,
    name: user.name?.trim() || user.username,
    applicationId: user.applicationId.toString(),
    applicationName: application,
    /** Null means the owner granted a lifetime account — shown as "Never". */
    expiresAt: user.expiresAt ? user.expiresAt.toISOString() : null,
    isExpired: isExpired(user.expiresAt),
    devicesUsed,
    maxDevices: user.maxDevices,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    // Owner's private remark about this customer. Never exposed here; stated
    // explicitly so the shape documents the decision.
    notes: null,
  };
}

/**
 * Update the one field an end user owns.
 *
 * Scoped to the session's own id: there is no id in the body, so this cannot be
 * aimed at another account. Everything the OWNER controls — ban, expiry, device
 * limit, notes — is absent from the accepted shape by construction rather than
 * by a check someone could forget.
 */
export async function updatePortalProfile(
  userId: string,
  applicationId: string,
  input: PortalUpdateProfileInput,
) {
  await connectToDatabase();

  const user = await AppUserModel.findOneAndUpdate(
    {
      _id: toObjectId(userId, "user id"),
      applicationId: toObjectId(applicationId, "application id"),
    },
    { $set: { name: input.name } },
    { returnDocument: "after", runValidators: true },
  ).lean();

  if (!user) throw ApiError.notFound("Account not found.");
  return { name: user.name?.trim() || user.username };
}

/**
 * Change the signed-in user's own password.
 *
 * Revokes every OTHER session for this end user — the game clients AND any
 * other browsers — so a stolen session dies the moment the owner rotates.
 */
export async function changePortalPassword(params: {
  userId: string;
  applicationId: string;
  currentPassword: string;
  newPassword: string;
}) {
  const { userId, applicationId, currentPassword, newPassword } = params;
  await connectToDatabase();

  const user = await AppUserModel.findOne({
    _id: toObjectId(userId, "user id"),
    applicationId: toObjectId(applicationId, "application id"),
  })
    .select("+passwordHash")
    .lean();

  if (!user) throw ApiError.notFound("Account not found.");

  // The step-up check. Deliberately required even though the caller already
  // holds a valid session: without it, a stolen portal cookie would let an
  // attacker lock the real owner out permanently.
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new ApiError(
      401,
      ErrorCode.CURRENT_PASSWORD_INCORRECT,
      "Current password is incorrect.",
    );
  }

  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw new ApiError(
      400,
      ErrorCode.PASSWORD_UNCHANGED,
      "The new password must be different from the current one.",
    );
  }

  await AppUserModel.updateOne(
    { _id: user._id },
    { $set: { passwordHash: await hashPassword(newPassword) } },
  );

  // Revoke every session for this user EXCEPT the portal session making the
  // request — otherwise the person would be logged out of the very page they
  // are standing on, having just proved they own it.
  const { hashToken } = await import("@/lib/tokens");
  const { readPortalToken } = await import("@/lib/portal-auth");
  const token = await readPortalToken();
  const keepHash = token ? hashToken(token) : null;

  await SessionModel.updateMany(
    {
      applicationId: user.applicationId,
      userId: user._id,
      revokedAt: null,
      ...(keepHash ? { tokenHash: { $ne: keepHash } } : {}),
    },
    { $set: { revokedAt: new Date() } },
  );

  await recordAuthEvent({
    applicationId: user.applicationId,
    userId: user._id,
    username: user.username,
    action: AuthAction.PASSWORD_RESET,
    success: true,
    deviceId: PORTAL_DEVICE_ID,
  });
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

/**
 * The signed-in user's own devices, newest activity first.
 *
 * Scoped by BOTH the session's userId and applicationId. The portal session
 * itself is not in this list: it is not a `devices` row, because a browser must
 * never consume a licence seat.
 *
 * `canDelete` is computed HERE, server-side, so the button in the UI and the
 * rule the DELETE endpoint enforces cannot drift apart — the client is never
 * asked to decide whether a deletion is allowed.
 */
export async function listPortalDevices(userId: string, applicationId: string) {
  await connectToDatabase();

  const devices = await DeviceModel.find({
    applicationId: toObjectId(applicationId, "application id"),
    userId: toObjectId(userId, "user id"),
  })
    .sort({ lastSeenAt: -1 })
    .lean();

  const idleMinutes = env.portalDeviceIdleMinutes;
  const now = Date.now();
  const cutoff = now - idleMinutes * 60_000;

  return {
    idleMinutes,
    devices: devices.map((device) => ({
      ...toPublicDevice(device),
      canDelete: idleMinutes === 0 || device.lastSeenAt.getTime() <= cutoff,
      idleMs: Math.max(0, now - device.lastSeenAt.getTime()),
    })),
  };
}

/**
 * Delete one of the signed-in user's devices.
 *
 * THE IDLE RULE — the whole reason this is not a straight DELETE. Freeing a
 * seat is a privilege, and with no delay it is trivially abusable: delete the
 * device you are using and you are signed out mid-request; churn through seats
 * and a full device list can be reset at will. So a device must have been quiet
 * for `PORTAL_DEVICE_IDLE_MINUTES` (default 60) before it can be removed, which
 * is also precisely when a person wants to remove it — a device abandoned last
 * week, not the one under their hands.
 *
 * `PORTAL_DEVICE_IDLE_MINUTES=0` disables the rule, for deployments that manage
 * devices elsewhere.
 *
 * Sessions on the removed device are revoked with it, or the holder would keep
 * authenticating from a device that no longer exists.
 */
export async function deletePortalDevice(
  userId: string,
  applicationId: string,
  deviceDocumentId: string,
): Promise<void> {
  await connectToDatabase();

  const userObjectId = toObjectId(userId, "user id");
  const appObjectId = toObjectId(applicationId, "application id");

  const device = await DeviceModel.findOne({
    _id: toObjectId(deviceDocumentId, "device id"),
    // Scoped to the OWNER OF THIS SESSION. A device id belonging to another
    // tenant, or to another user in the same app, simply does not match.
    applicationId: appObjectId,
    userId: userObjectId,
  }).lean();

  if (!device) throw ApiError.notFound("Device not found.");

  const idleMinutes = env.portalDeviceIdleMinutes;
  if (idleMinutes > 0) {
    const idleMs = Date.now() - device.lastSeenAt.getTime();
    const waitMs = idleMinutes * 60_000;
    if (idleMs < waitMs) {
      const minutesLeft = Math.max(1, Math.ceil((waitMs - idleMs) / 60_000));
      throw new ApiError(
        409,
        ErrorCode.DEVICE_STILL_ACTIVE,
        `This device was active recently and cannot be removed yet. Try again in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.`,
      );
    }
  }

  await DeviceModel.deleteOne({ _id: device._id });

  // Revoke its sessions too, or the holder keeps access from a device the owner
  // has just deleted.
  await SessionModel.updateMany(
    {
      applicationId: appObjectId,
      userId: userObjectId,
      deviceId: device.deviceId,
      revokedAt: null,
    },
    { $set: { revokedAt: new Date() } },
  );

  await recordAuthEvent({
    applicationId: appObjectId,
    userId: userObjectId,
    action: AuthAction.DEVICE_REMOVED,
    success: true,
    reason: "REMOVED_BY_USER",
    deviceId: device.deviceId,
  });
}

// ---------------------------------------------------------------------------
// Small local helpers — these ids all came out of the SESSION, but they are
// still validated: "trusted input" is a property of a system, not a promise.
// ---------------------------------------------------------------------------

function toObjectId(value: string, label = "identifier"): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw ApiError.validation(`Invalid ${label}.`);
  }
  return new Types.ObjectId(value);
}

/** The application row, for displaying its name on the portal. */
async function findApplicationName(
  applicationId: string,
): Promise<string | null> {
  const { ApplicationModel } = await import("@/models/Application");
  const application = await ApplicationModel.findById(
    toObjectId(applicationId, "application id"),
  )
    .select("name")
    .lean();
  return application?.name ?? null;
}