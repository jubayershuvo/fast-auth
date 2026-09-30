import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * An authenticated end-user session for a customer application.
 *
 * Presented by the customer's own game/desktop client as
 * `Authorization: Bearer <token>`. Only the SHA-256 hash is stored, so a
 * database dump yields no usable bearer tokens.
 */
const sessionSchema = new Schema(
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
    /** Links a session to the device it was issued on (for per-device revoke). */
    deviceId: { type: String, required: true, maxlength: 128 },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // NOTE: no `index: true` here — declaring it both here and via
    // `schema.index()` below makes Mongoose drop the whole definition
    // (including `expireAfterSeconds`), silently disabling TTL cleanup.
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: Date.now },
    ip: { type: String, default: null, maxlength: 64 },
    userAgent: { type: String, default: null, maxlength: 300 },
  },
  {
    timestamps: true,
    collection: "sessions",
  },
);

// Automatic cleanup once expired (60s grace). Revocation is immediate/deletion.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 });
// "Revoke all sessions for this user" / "active sessions" listings.
sessionSchema.index({ applicationId: 1, userId: 1, revokedAt: 1 });
// Device-scoped revocation.
sessionSchema.index({ applicationId: 1, userId: 1, deviceId: 1 });

export type Session = InferSchemaType<typeof sessionSchema>;

export type PublicSession = {
  id: string;
  deviceId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string;
  ip: string | null;
  isActive: boolean;
};

export function toPublicSession(session: {
  _id: { toString(): string };
  deviceId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date;
  ip: string | null;
}): PublicSession {
  return {
    id: session._id.toString(),
    deviceId: session.deviceId,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    revokedAt: session.revokedAt ? session.revokedAt.toISOString() : null,
    lastUsedAt: session.lastUsedAt.toISOString(),
    ip: session.ip,
    isActive: session.revokedAt === null && session.expiresAt.getTime() > Date.now(),
  };
}

export const SessionModel =
  models.Session ?? model<Session>("Session", sessionSchema);
