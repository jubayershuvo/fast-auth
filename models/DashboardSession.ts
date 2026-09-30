import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * Dashboard (customer) login session.
 *
 * Distinct from `models/Session.ts`, which holds end-user sessions for
 * customer applications. Keeping them apart means a customer session token can
 * never be presented to the /api/v1 auth endpoints (or vice-versa).
 *
 * Only `tokenHash` is stored — the raw token lives solely in the httpOnly
 * cookie on the owner's browser.
 */
const dashboardSessionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
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
      // NOTE: no `index: true` here — declaring it both here and via
      // `schema.index()` below makes Mongoose drop the whole definition
      // (including `expireAfterSeconds`), silently disabling TTL cleanup.
    },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: Date.now },
    // Lightweight request fingerprint for the account's own security view.
    ip: { type: String, default: null },
    userAgent: { type: String, default: null, maxlength: 300 },
  },
  {
    timestamps: true,
    collection: "dashboard_sessions",
  },
);

// TTL index: Mongo removes expired sessions automatically after 60s grace.
// A revoked session is deleted immediately, so this only ever catches expiry.
dashboardSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 });

export type DashboardSession = InferSchemaType<typeof dashboardSessionSchema>;

export const DashboardSessionModel =
  models.DashboardSession ??
  model<DashboardSession>("DashboardSession", dashboardSessionSchema);
