import { Schema, model, models, type InferSchemaType, type Types } from "mongoose";

import { searchAny } from "@/lib/search";

/**
 * Query filter for the audit trail.
 *
 * Shared by the dashboard page and the JSON route so the two cannot drift — they
 * previously each rebuilt the filter inline, which is how a page and its API
 * quietly start disagreeing about what "the logs" means.
 *
 * Takes an ObjectId rather than a string so the caller owns validation and this
 * stays free of a models -> authorization import cycle.
 *
 * `search` is escaped by `searchAny`, so a term such as ".*" is matched
 * literally instead of sweeping the whole collection. The `$and` wrapper keeps
 * the free-text `$or` from colliding with the `action` equality filter.
 */
export function buildAuthLogFilter(
  applicationId: Types.ObjectId,
  options: { action?: string; search?: string } = {},
): Record<string, unknown> {
  const filter: Record<string, unknown> = { applicationId };
  if (options.action) filter.action = options.action;

  const matches = searchAny(options.search, [
    "action", "username", "deviceId", "ip", "userAgent",
  ]);
  if (matches) filter.$and = [{ $or: matches }];

  return filter;
}

/** The full set of auditable authentication events. */
export const AuthAction = {
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  LOGIN_FAILED: "LOGIN_FAILED",
  ACCOUNT_BANNED: "ACCOUNT_BANNED",
  ACCOUNT_UNBANNED: "ACCOUNT_UNBANNED",
  ACCOUNT_EXPIRED: "ACCOUNT_EXPIRED",
  DEVICE_ADDED: "DEVICE_ADDED",
  DEVICE_REMOVED: "DEVICE_REMOVED",
  SESSION_CREATED: "SESSION_CREATED",
  SESSION_REVOKED: "SESSION_REVOKED",
  SESSION_RENEWED: "SESSION_RENEWED",
  LOGOUT: "LOGOUT",
  TOKEN_VALIDATED: "TOKEN_VALIDATED",
  USER_CREATED: "USER_CREATED",
  USER_UPDATED: "USER_UPDATED",
  USER_DELETED: "USER_DELETED",
  PASSWORD_RESET: "PASSWORD_RESET",
  /** Owner pressed Stop on the whole application. */
  APP_SUSPENDED: "APP_SUSPENDED",
  /** Owner pressed Start again. */
  APP_RESUMED: "APP_RESUMED",
} as const;

export type AuthActionValue = (typeof AuthAction)[keyof typeof AuthAction];

/**
 * Append-only audit trail of authentication events per application.
 *
 * PRIVACY: this records identifiers (username, IP, device id) and outcomes —
 * never passwords, tokens, or secret material. `username` is denormalised
 * deliberately so history survives deletion of the user row.
 */
const authLogSchema = new Schema(
  {
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      index: true,
    },
    // Nullable: a failed login for a non-existent username has no userId.
    userId: {
      type: Schema.Types.ObjectId,
      ref: "AppUser",
      default: null,
      index: true,
    },
    // Denormalised snapshot for display after the user is deleted.
    username: {
      type: String,
      default: null,
      // Mirrors `AppUser.username` (254), NOT the dashboard's 32. This is a
      // DENORMALISED copy of an end-user handle, and end-user handles are
      // deliberately unconstrained — a UUID is 36 characters, an opaque token
      // is longer. Leaving this at 32 did not reject the user: `logger.ts`
      // swallows the failure, so account creation SUCCEEDED while the audit
      // record was silently discarded. An audit trail with holes in it is worse
      // than no audit trail, because it looks complete.
      maxlength: 254,
    },
    action: {
      type: String,
      required: true,
      enum: Object.values(AuthAction),
    },
    success: { type: Boolean, required: true, default: true },
    /** Machine-readable failure code, e.g. ACCOUNT_BANNED. Never free text secrets. */
    reason: { type: String, default: null, maxlength: 64 },
    ip: { type: String, default: null, maxlength: 64 },
    deviceId: { type: String, default: null, maxlength: 128 },
    userAgent: { type: String, default: null, maxlength: 300 },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: "auth_logs",
  },
);

// Backs the logs table (newest first) and the dashboard "recent events" feed.
authLogSchema.index({ applicationId: 1, createdAt: -1 });
authLogSchema.index({ applicationId: 1, action: 1, createdAt: -1 });
// Success-rate queries.
authLogSchema.index({ applicationId: 1, success: 1, createdAt: -1 });

export type AuthLog = InferSchemaType<typeof authLogSchema>;

export type PublicAuthLog = {
  id: string;
  username: string | null;
  action: string;
  success: boolean;
  reason: string | null;
  ip: string | null;
  deviceId: string | null;
  createdAt: string;
};

export function toPublicAuthLog(log: {
  _id: { toString(): string };
  username: string | null;
  action: string;
  success: boolean;
  reason: string | null;
  ip: string | null;
  deviceId: string | null;
  createdAt: Date;
}): PublicAuthLog {
  return {
    id: log._id.toString(),
    username: log.username,
    action: log.action,
    success: log.success,
    reason: log.reason,
    ip: log.ip,
    deviceId: log.deviceId,
    createdAt: log.createdAt.toISOString(),
  };
}

export const AuthLogModel =
  models.AuthLog ?? model<AuthLog>("AuthLog", authLogSchema);
