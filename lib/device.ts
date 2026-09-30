import "server-only";

import { Types } from "mongoose";

import { ApiError, ErrorCode } from "@/lib/errors";
import { connectToDatabase } from "@/lib/mongodb";
import { toObjectId } from "@/lib/authorization";
import { recordAuthEvent } from "@/lib/logger";
import { AuthAction } from "@/models/AuthLog";
import { AppUserModel } from "@/models/AppUser";
import { DeviceModel, toPublicDevice, type PublicDevice } from "@/models/Device";
import { SessionModel } from "@/models/Session";
import type { PaginationInput, UpdateDeviceInput } from "@/lib/validation";
import { searchAny } from "@/lib/search";

/**
 * Device service.
 *
 * SECURITY MODEL (restated, because this is the most commonly misunderstood
 * part of a licensing system):
 *
 * `deviceId` is a client-supplied identifier. A modified client can claim any
 * value, so it cannot prove "the same physical machine". The guarantees we do
 * provide are:
 *   - a licence is capped at N concurrently registered devices;
 *   - each device is enumerable, named and individually revocable by the owner;
 *   - every registration/removal is written to the audit log;
 *   - sessions are bound to the device that created them.
 *
 * In short: a seat-control mechanism, not tamper-proof DRM. Real hardware
 * binding requires platform attestation (TPM / Play Integrity / Keychain).
 */

export type DeviceRegistrationResult = {
  status: "registered" | "existing";
  device: PublicDevice;
  devicesUsed: number;
  maxDevices: number;
};

/**
 * Register a device for a user, enforcing the seat limit.
 *
 * The unique index on {applicationId, userId, deviceId} is the real guard
 * against a race where two concurrent logins both read "1 of 2 seats used"
 * and both insert a third. The count check is the fast path; the index is the
 * guarantee.
 */
export async function registerDevice(params: {
  applicationId: Types.ObjectId;
  userId: Types.ObjectId;
  deviceId: string;
  deviceName?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  platform?: string | null;
}): Promise<DeviceRegistrationResult> {
  const { applicationId, userId, deviceId } = params;
  const now = new Date();

  const existing = await DeviceModel.findOne({ applicationId, userId, deviceId }).lean();
  if (existing) {
    // Known device: refresh liveness only. Never consumes a new seat.
    await DeviceModel.updateOne(
      { _id: existing._id },
      { $set: { lastSeenAt: now, lastIp: params.ip ?? existing.lastIp } },
    );
    const used = await DeviceModel.countDocuments({ applicationId, userId });
    const owner = await AppUserModel.findById(userId).select("maxDevices").lean();
    return {
      status: "existing",
      device: toPublicDevice({ ...existing, lastSeenAt: now }),
      devicesUsed: used,
      maxDevices: owner?.maxDevices ?? 1,
    };
  }

  const owner = await AppUserModel.findById(userId).select("maxDevices").lean();
  const maxDevices = owner?.maxDevices ?? 1;
  const used = await DeviceModel.countDocuments({ applicationId, userId });

  if (used >= maxDevices) {
    throw new ApiError(
      403,
      ErrorCode.DEVICE_LIMIT_REACHED,
      `Device limit reached (${used}/${maxDevices}). Contact support to reset your devices.`,
    );
  }

  try {
    const device = await DeviceModel.create({
      applicationId,
      userId,
      deviceId,
      deviceName: params.deviceName ?? null,
      firstSeenAt: now,
      lastSeenAt: now,
      lastIp: params.ip ?? null,
      metadata: {
        platform: params.platform ?? null,
        userAgent: params.userAgent ? params.userAgent.slice(0, 300) : null,
      },
    });

    await recordAuthEvent({
      applicationId,
      userId,
      action: AuthAction.DEVICE_ADDED,
      success: true,
      deviceId,
      ip: params.ip ?? null,
    });

    return {
      status: "registered",
      device: toPublicDevice(device),
      devicesUsed: used + 1,
      maxDevices,
    };
  } catch (error) {
    // Unique-index violation => a concurrent request already registered this
    // exact device. That is a success, not a failure.
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === 11000
    ) {
      const device = await DeviceModel.findOne({ applicationId, userId, deviceId }).lean();
      if (device) {
        return {
          status: "existing",
          device: toPublicDevice(device),
          devicesUsed: await DeviceModel.countDocuments({ applicationId, userId }),
          maxDevices,
        };
      }
    }
    throw error;
  }
}

export async function listDevices(
  applicationId: string,
  options: PaginationInput & { userId?: string; search?: string },
): Promise<{ devices: PublicDevice[]; total: number }> {
  await connectToDatabase();
  const filter: Record<string, unknown> = {
    applicationId: toObjectId(applicationId, "application id"),
  };
  if (options.userId) filter.userId = toObjectId(options.userId, "user id");
  if (options.search) {
    // Escaped + case-insensitive across the fields an owner recognises a
    // device by. Filtering in the query (not in JS) keeps the total honest.
    const matches = searchAny(options.search, [
      "deviceId", "deviceName", "platform", "lastIp",
    ]);
    if (matches) filter.$or = matches;
  }

  const skip = (options.page - 1) * options.limit;
  const [devices, total] = await Promise.all([
    // The owner is populated here (and only here) so the table can name the
    // user each device belongs to. Scoped to this page's rows, so it is one
    // extra query rather than one per device.
    DeviceModel.find(filter)
      .populate("userId", "username")
      .sort({ lastSeenAt: -1 })
      .skip(skip)
      .limit(options.limit)
      .lean(),
    DeviceModel.countDocuments(filter),
  ]);

  return { devices: devices.map(toPublicDevice), total };
}

/**
 * Remove one device, revoking the sessions bound to it.
 *
 * Sessions are FLAGGED (revokedAt) rather than deleted, matching
 * `revokeAllUserSessions`. Deleting the row would also stop the token working,
 * but the client would then see a generic "Invalid session token" instead of
 * SESSION_REVOKED — losing the distinction between a session that was valid
 * and was withdrawn, and one that never existed. A TTL index reaps the rows,
 * so nothing accumulates.
 */
/**
 * Edit a registered device's display name and/or its deviceId.
 *
 * `deviceName` is cosmetic. `deviceId` is NOT, and the difference matters:
 *
 *  - The deviceId is what the client sends at login to identify itself. After a
 *    change, a client still sending the OLD id presents an unknown device, so
 *    it registers a NEW row and consumes another seat from its own budget. That
 *    is correct — the old identifier is genuinely a different machine to this
 *    system now — but the owner has to know, so the UI says so.
 *  - Existing sessions are deliberately NOT revoked: the seat and the live
 *    session are unchanged, and the user stays signed in.
 *  - A deviceId that collides with another of the SAME user's devices is
 *    refused with 409. Two rows sharing an identifier would silently collapse
 *    into one on the next login, and the unique index would then reject it.
 *
 * Scoped to the application so a tenant cannot edit another tenant's device,
 * and the userId is never taken from the request body.
 */
export async function updateDevice(
  applicationId: string,
  deviceId: string,
  input: UpdateDeviceInput,
): Promise<PublicDevice> {
  await connectToDatabase();
  const appObjectId = toObjectId(applicationId, "application id");
  const deviceObjectId = toObjectId(deviceId, "device id");

  const current = await DeviceModel.findOne({
    _id: deviceObjectId,
    applicationId: appObjectId,
  }).lean();
  if (!current) throw ApiError.notFound("Device not found.");

  const update: Record<string, unknown> = {};
  if (input.deviceName !== undefined) update.deviceName = input.deviceName;

  if (input.deviceId !== undefined && input.deviceId !== current.deviceId) {
    // The unique index is {applicationId, userId, deviceId}: uniqueness is
    // per-user, not per-application, so the clash check must match that scope.
    const clash = await DeviceModel.exists({
      applicationId: appObjectId,
      userId: current.userId,
      deviceId: input.deviceId,
    });
    if (clash) {
      throw ApiError.conflict(
        ErrorCode.DUPLICATE,
        "That device ID is already registered for this user.",
      );
    }
    update.deviceId = input.deviceId;
  }

  const device = await DeviceModel.findOneAndUpdate(
    { _id: deviceObjectId, applicationId: appObjectId },
    { $set: update },
    { returnDocument: "after", runValidators: true },
  ).lean();

  if (!device) throw ApiError.notFound("Device not found.");
  return toPublicDevice(device);
}

export async function removeDevice(
  applicationId: string,
  deviceId: string,
  revokeSessions = true,
): Promise<void> {
  await connectToDatabase();
  const appObjectId = toObjectId(applicationId, "application id");

  const device = await DeviceModel.findOneAndDelete({
    _id: toObjectId(deviceId, "device id"),
    applicationId: appObjectId,
  }).lean();
  if (!device) throw ApiError.notFound("Device not found.");

  if (revokeSessions) {
    await SessionModel.updateMany(
      {
        applicationId: appObjectId,
        userId: device.userId,
        deviceId: device.deviceId,
        revokedAt: null,
      },
      { $set: { revokedAt: new Date() } },
    );
  }

  await recordAuthEvent({
    applicationId: appObjectId,
    userId: device.userId,
    action: AuthAction.DEVICE_REMOVED,
    success: true,
    deviceId: device.deviceId,
  });
}

/**
 * Reset every device for a user, freeing all seats.
 *
 * Sessions are revoked alongside: otherwise the customer retains unlimited
 * concurrent access through devices that are no longer supposed to exist.
 */
export async function resetUserDevices(applicationId: string, userId: string): Promise<number> {
  await connectToDatabase();
  const appObjectId = toObjectId(applicationId, "application id");
  const userObjectId = toObjectId(userId, "user id");

  const result = await DeviceModel.deleteMany({
    applicationId: appObjectId,
    userId: userObjectId,
  });
  // Flag rather than delete, for the same reason as removeDevice: the client
  // gets SESSION_REVOKED, which is far easier to act on than "invalid token".
  await SessionModel.updateMany(
    { applicationId: appObjectId, userId: userObjectId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );

  const user = await AppUserModel.findById(userObjectId).select("username").lean();

  await recordAuthEvent({
    applicationId: appObjectId,
    userId: userObjectId,
    username: user?.username ?? null,
    action: AuthAction.DEVICE_REMOVED,
    success: true,
    reason: "RESET_ALL",
  });

  return result.deletedCount ?? 0;
}
