import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * A device registered against an application user.
 *
 * SECURITY MODEL — read this before trusting `deviceId`:
 *
 * `deviceId` (often a client-supplied HWID) is an *identifier and registration
 * signal*, not proof of physical device identity. A hostile client can claim
 * any value it likes, so a client can:
 *   - impersonate a device it has already seen, and
 *   - reset the counter by presenting a fresh id, up to the limit.
 *
 * Therefore the limit here is a **licence seat control** (stops casual sharing
 * and mass account creation), NOT tamper-proof DRM. Real hardware binding
 * requires attestation (TPM/Play Integrity/Keychain) which is a separate
 * mechanism. What this design does guarantee is that a single session cannot
 * silently exceed the seat count, that sessions and devices are revocable, and
 * that every device action is auditable via AuthLog.
 */
const deviceSchema = new Schema(
  {
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "AppUser",
      required: true,
      index: true,
    },
    /** Opaque client identifier (HWID, install id, ...). */
    deviceId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
    },
    // 80 matches `deviceNameSchema` and the dashboard's edit field. It was 120,
    // which let a client store a name the owner could then never edit without
    // shortening it first — one accepted value, rejected on another path.
    deviceName: { type: String, default: null, maxlength: 80 },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    lastIp: { type: String, default: null, maxlength: 64 },
    metadata: {
      platform: { type: String, default: null, maxlength: 64 },
      userAgent: { type: String, default: null, maxlength: 300 },
    },
  },
  {
    timestamps: true,
    collection: "devices",
  },
);

// A device id is unique per (application, user) — the seat counting key.
deviceSchema.index(
  { applicationId: 1, userId: 1, deviceId: 1 },
  { unique: true },
);
// Backs the "devices used / max" display and the limit check.
deviceSchema.index({ applicationId: 1, userId: 1, lastSeenAt: -1 });

export type Device = InferSchemaType<typeof deviceSchema>;

export type PublicDevice = {
  id: string;
  deviceId: string;
  deviceName: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastIp: string | null;
  platform: string | null;
  /**
   * Owning end user. Exposed so the app-wide device list can say WHICH user a
   * device belongs to — without it, a cross-user list is unactionable, since
   * the owner cannot tell whose seat is being consumed.
   */
  userId: string;
  /**
   * Owning user's name, denormalised for display. Null unless the caller
   * populated it — single-device paths (register, update) have no reason to
   * pay for the join, and the id is always there as the fallback.
   */
  username: string | null;
};

/**
 * Normalise a `userId` field that may or may not have been populated.
 *
 * `listDevices` populates `userId` to show the owner's username, which replaces
 * the field with the whole document. Everywhere else it stays a raw ObjectId.
 * Calling `.toString()` on the populated case silently yields
 * "[object Object]", which breaks every link built from `device.userId` — so
 * both shapes are handled here rather than at each call site.
 */
function ownerIdToString(
  value: { toString(): string } | { _id: { toString(): string } },
): string {
  return "_id" in value ? value._id.toString() : value.toString();
}

/** The owner's name, present only when `userId` was populated. */
function ownerUsername(
  value: { toString(): string } | { _id: { toString(): string }; username?: string },
): string | null {
  return "_id" in value ? (value.username ?? null) : null;
}

export function toPublicDevice(device: {
  _id: { toString(): string };
  userId: { toString(): string } | { _id: { toString(): string }; username?: string };
  deviceId: string;
  deviceName: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastIp: string | null;
  metadata?: { platform: string | null } | null;
  /** Present only when the listing populated the owner. */
  username?: string | null;
}): PublicDevice {
  return {
    id: device._id.toString(),
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    firstSeenAt: device.firstSeenAt.toISOString(),
    lastSeenAt: device.lastSeenAt.toISOString(),
    lastIp: device.lastIp,
    platform: device.metadata?.platform ?? null,
    userId: ownerIdToString(device.userId),
    // A populated `userId` carries the name on the SUB-document, not on the
    // device itself — reading `device.username` here always returned null and
    // left the USER column blank.
    username: device.username ?? ownerUsername(device.userId),
  };
}

export const DeviceModel =
  models.Device ?? model<Device>("Device", deviceSchema);
