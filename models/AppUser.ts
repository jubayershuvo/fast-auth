import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * An end-user of a customer application ("player123" in "MyGame").
 *
 * Completely separate identity space from the dashboard `User`. The same
 * username may exist in two different applications without collision, and
 * login always requires the `appId` to resolve which space to search.
 */
const appUserSchema = new Schema(
  {
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      index: true,
    },
    username: {
      type: String,
      required: [true, "Username is required."],
      trim: true,
      // Bounds mirror `appUserUsernameSchema`, NOT the dashboard's
      // `[a-z0-9_.-]{3,32}`. An end-user handle belongs to the customer's
      // product, so it may be an opaque token, a UUID or any unicode string;
      // only emptiness and a storage ceiling are enforced here. Relaxing this
      // in validation.ts without relaxing it here would leave Mongoose
      // rejecting perfectly valid end users with a bare ValidationError.
      minlength: 1,
      maxlength: 254,
    },
    /**
     * Human display name. Distinct from `username`, which is the login handle
     * the client authenticates with.
     *
     * `required` applies to new and updated documents only; rows predating this
     * field have no value, so `toPublicAppUser` falls back to the username
     * rather than rendering a blank in the owner's user list.
     */
    name: {
      type: String,
      required: [true, "Name is required."],
      trim: true,
      minlength: 1,
      maxlength: 80,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },

    // --- ban ---
    isBanned: { type: Boolean, default: false },
    banReason: { type: String, default: null, maxlength: 280 },
    bannedAt: { type: Date, default: null },

    /**
     * Absolute expiry as a real Date. `null` means the account never expires.
     * A stored "days: 30" counter cannot express "expired 3 days ago", which
     * is exactly what the expiry and extend logic needs to reason about.
     */
    expiresAt: { type: Date, default: null },
    /** Set when an owner overrides maxDevices per user. */
    maxDevices: { type: Number, default: 1, min: 1, max: 100 },

    lastLoginAt: { type: Date, default: null },
    notes: { type: String, default: "", maxlength: 500 },
  },
  {
    timestamps: true,
    collection: "app_users",
  },
);

// Usernames are only unique WITHIN an application — the core tenancy rule.
appUserSchema.index({ applicationId: 1, username: 1 }, { unique: true });
// Backs the dashboard's active/expired/banned filters.
appUserSchema.index({ applicationId: 1, isBanned: 1, expiresAt: 1 });

export type AppUser = InferSchemaType<typeof appUserSchema>;

export type PublicAppUser = {
  id: string;
  applicationId: string;
  username: string;
  name: string;
  isBanned: boolean;
  banReason: string | null;
  bannedAt: string | null;
  expiresAt: string | null;
  isExpired: boolean;
  maxDevices: number;
  lastLoginAt: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

/** Pure helper — reusable in API responses and server components alike. */
export function isExpired(expiresAt: Date | null, now: Date = new Date()): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

export function toPublicAppUser(
  user: {
    _id: { toString(): string };
    applicationId: { toString(): string };
    username: string;
    /** Absent on documents written before the field existed. */
    name?: string | null;
    isBanned: boolean;
    banReason: string | null;
    bannedAt: Date | null;
    expiresAt: Date | null;
    maxDevices: number;
    lastLoginAt: Date | null;
    notes: string;
    createdAt: Date;
    updatedAt: Date;
  },
  now: Date = new Date(),
): PublicAppUser {
  return {
    id: user._id.toString(),
    applicationId: user.applicationId.toString(),
    username: user.username,
    // Never blank: the username is always present and is a reasonable stand-in
    // for rows predating the `name` field.
    name: user.name?.trim() || user.username,
    isBanned: user.isBanned,
    banReason: user.banReason,
    bannedAt: user.bannedAt ? user.bannedAt.toISOString() : null,
    expiresAt: user.expiresAt ? user.expiresAt.toISOString() : null,
    isExpired: isExpired(user.expiresAt, now),
    maxDevices: user.maxDevices,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    notes: user.notes,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export const AppUserModel =
  models.AppUser ?? model<AppUser>("AppUser", appUserSchema);
