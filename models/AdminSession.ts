import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * Platform-admin login session.
 *
 * Kept apart from `DashboardSession` so the two cookie namespaces cannot
 * collide or be replayed against each other. As with customer sessions, only
 * the SHA-256 hash of the token is persisted.
 */
const adminSessionSchema = new Schema(
  {
    adminId: {
      type: Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      // No `index: true` here — it is declared via schema.index() below.
      // Declaring both makes Mongoose discard the definition *including*
      // expireAfterSeconds, silently disabling TTL cleanup.
    },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: Date.now },
    ip: { type: String, default: null, maxlength: 64 },
    userAgent: { type: String, default: null, maxlength: 300 },
  },
  {
    timestamps: true,
    collection: "admin_sessions",
  },
);

adminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 });

export type AdminSession = InferSchemaType<typeof adminSessionSchema>;

export const AdminSessionModel =
  models.AdminSession ?? model<AdminSession>("AdminSession", adminSessionSchema);
