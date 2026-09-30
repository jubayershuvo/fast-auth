import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * A customer application, e.g. "MyGame" or "MySoftware".
 *
 * Multi-tenancy boundary: every AppUser / Device / Session / AuthLog row
 * carries an `applicationId`, and every dashboard query is additionally
 * scoped by the owning User's id. Users of one application can never be
 * reached through another application's routes.
 */
const applicationSchema = new Schema(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Application name is required."],
      trim: true,
      maxlength: 64,
    },
    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 280,
    },
    /** Public client identifier, e.g. `fa_9Xq2...`. Unique, not a secret. */
    appId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    /**
     * SHA-256 hash of the app secret. The plaintext is returned exactly once
     * (on create / rotate) and is unrecoverable afterwards.
     */
    appSecretHash: {
      type: String,
      required: true,
      select: false,
    },
    /** Last 4 chars of the secret, so the owner can identify which key is live. */
    appSecretFingerprint: { type: String, required: true },
    appSecretRotatedAt: { type: Date, default: Date.now },
    /**
     * Owner-controlled on/off switch for the whole application.
     *
     * When "suspended", every /api/v1 authentication call is refused — new
     * logins AND existing sessions. Intentionally reversible: stopping the app
     * does not delete sessions, so starting it again restores service without
     * forcing every end user to log in once more.
     *
     * Defaults to "active" so rows written before this field existed keep
     * working instead of silently blocking their owner.
     */
    status: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
      index: true,
    },
  },
  {
    timestamps: true,
    collection: "applications",
  },
);

export type Application = InferSchemaType<typeof applicationSchema>;

export type PublicApplication = {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  appId: string;
  appSecretFingerprint: string;
  appSecretRotatedAt: string;
  /** "active" | "suspended" — the owner's on/off switch for the v1 API. */
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
};

export const APPLICATION_STATUSES = ["active", "suspended"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export function toPublicApplication(app: {
  _id: { toString(): string };
  ownerId: { toString(): string };
  name: string;
  description: string;
  appId: string;
  appSecretFingerprint: string;
  appSecretRotatedAt: Date;
  status?: ApplicationStatus;
  createdAt: Date;
  updatedAt: Date;
}): PublicApplication {
  return {
    id: app._id.toString(),
    ownerId: app.ownerId.toString(),
    name: app.name,
    description: app.description,
    appId: app.appId,
    // The hash is deliberately absent — never serialised.
    appSecretFingerprint: app.appSecretFingerprint,
    appSecretRotatedAt: app.appSecretRotatedAt.toISOString(),
    // Defaulted, not just passed through: documents written before `status`
    // existed have no value, and treating that as suspended would silently
    // lock every existing owner's app out of their own v1 API.
    status: app.status ?? "active",
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
  };
}

export const ApplicationModel =
  models.Application ?? model<Application>("Application", applicationSchema);
