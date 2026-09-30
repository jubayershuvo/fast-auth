import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * Dashboard account — ONE model for every customer, however they arrived.
 *
 * There is deliberately no separate "platform account" collection. An account
 * created by an operator through the API key realm and an account created by a
 * human on /register are the SAME row with a different `authSource`:
 *
 *   "self"     — the person filled in the signup form. Password set, email
 *                must be verified.
 *   "platform" — an operator created it on their behalf. NO password exists.
 *   "oauth"    — social sign-in created it. NO password exists.
 *
 * `passwordHash === null` is the single source of truth for "this account has
 * no password", and it is the ONLY thing the sign-in path checks. That is why
 * `authSource` is descriptive rather than load-bearing: a platform account that
 * later sets a password through the emailed-code flow simply has a hash, and
 * from that moment it signs in exactly like any other account. No migration, no
 * second table, no divergence between the two kinds of customer.
 */
const userSchema = new Schema(
  {
    email: {
      type: String,
      required: [true, "Email is required."],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      index: true,
    },
    username: {
      type: String,
      required: [true, "Username is required."],
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 32,
      index: true,
    },
    /**
     * Human display name. Distinct from `username`, which is a login handle.
     *
     * `required` applies to new and updated documents only. Rows created before
     * this field existed have no value, so `toPublicUser` falls back to the
     * username rather than rendering a blank next to a support ticket.
     */
    name: {
      type: String,
      required: [true, "Name is required."],
      trim: true,
      minlength: 1,
      maxlength: 80,
    },
    /**
     * bcrypt hash. NULL means "this account has no password".
     *
     * That is the case for an OAuth-only account and for a platform-created
     * account that has not yet claimed one. The sign-in path MUST treat a
     * missing hash as "invalid credentials" and, for a platform account, offer
     * the emailed-code password setup instead — never as a match.
     */
    passwordHash: {
      type: String,
      default: null,
      // Never returned unless explicitly selected.
      select: false,
    },
    /**
     * How this account came into existence. Descriptive, not authorisation —
     * see the note at the top of this file.
     */
    authSource: {
      type: String,
      enum: ["self", "platform", "oauth"],
      default: "self",
      index: true,
    },
    /**
     * Has the person proved they read mail at this address?
     *
     * A self-registered account is UNVERIFIED until the emailed code is
     * entered, and cannot sign in before then. A platform-created account is
     * created already verified: the operator supplied the address, so there is
     * nothing for the customer to prove and nothing to wait for.
     */
    emailVerified: { type: Boolean, default: false, index: true },
    emailVerifiedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null, maxlength: 64 },

    /**
     * Subscription tier. Controls the maximum number of applications this
     * account may own — see lib/plans.ts for the catalogue.
     * Defaults to the free plan for every new account, including OAuth ones.
     */
    plan: {
      type: String,
      enum: ["free", "starter", "pro", "unlimited"],
      default: "free",
      index: true,
    },
    /** Audit trail for plan changes, so a downgrade is always explainable. */
    planChangedAt: { type: Date, default: null },
    planChangedBy: { type: String, default: null, maxlength: 254 },
  },
  {
    timestamps: true,
    collection: "users",
  },
);

export type User = InferSchemaType<typeof userSchema>;

export type UserAuthSource = User["authSource"];

/** Shape safe to serialise to a client (no passwordHash). */
export type PublicUser = {
  id: string;
  email: string;
  username: string;
  name: string;
  /** How the account was created. Never contains credential material. */
  authSource: UserAuthSource;
  /** True once the address has been proven (or was supplied by an operator). */
  emailVerified: boolean;
  /** True when a password exists. The UI uses this to route to setup. */
  hasPassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

/**
 * Derive the safe public shape.
 *
 * `hasPassword` is computed from the hash rather than stored, so it can never
 * drift out of step with the thing it describes. When `passwordHash` was not
 * selected it reads as `false` — the conservative direction, since a caller that
 * forgot `.select("+passwordHash")` then sees "no password" rather than
 * wrongly asserting one exists.
 */
export function toPublicUser(user: {
  _id: { toString(): string };
  email: string;
  username: string;
  /** Absent on documents written before the field existed. */
  name?: string | null;
  /** Must be explicitly selected; `select: false` keeps it out by default. */
  passwordHash?: string | null;
  /** Absent on documents written before the field existed. */
  authSource?: UserAuthSource | null;
  /** Absent on documents written before the field existed. */
  emailVerified?: boolean | null;
  createdAt: Date;
  lastLoginAt?: Date | null;
}): PublicUser {
  return {
    id: user._id.toString(),
    email: user.email,
    username: user.username,
    // Never blank: the username is always present and is a reasonable stand-in
    // until the account holder sets a real name.
    name: user.name?.trim() || user.username,
    // Defaulted to "self": rows predating the field were all self-registered.
    authSource: user.authSource ?? "self",
    emailVerified: user.emailVerified ?? false,
    hasPassword: Boolean(user.passwordHash),
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
  };
}

// Hot-reload safe: reuse the compiled model if it already exists.
export const UserModel =
  models.User ?? model<User>("User", userSchema);
