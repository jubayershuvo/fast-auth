import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * Platform administrator (the project owner / operator).
 *
 * DELIBERATELY a separate model from `models/User.ts`:
 *   - A customer session cookie can never be presented to an admin route, and
 *     an admin cookie can never be presented to the customer dashboard.
 *   - There is no `role` field on the customer model, so no customer-facing
 *     API (or mass-assignment bug) can ever promote a customer to admin.
 *   - The blast radius of a compromised account is contained.
 *
 * Administrators are created ONLY by `npm run create-admin`. There is
 * intentionally no HTTP endpoint that can create one.
 */
const adminUserSchema = new Schema(
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
     * bcrypt hash. OPTIONAL: an administrator who only signs in through an
     * OAuth provider has no password. The password sign-in path must treat a
     * missing hash as "invalid credentials", never as a match.
     */
    passwordHash: {
      type: String,
      default: null,
      // Never returned unless explicitly selected.
      select: false,
    },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null, maxlength: 64 },
  },
  {
    timestamps: true,
    collection: "admin_users",
  },
);

export type AdminUser = InferSchemaType<typeof adminUserSchema>;

export const AdminUserModel =
  models.AdminUser ?? model<AdminUser>("AdminUser", adminUserSchema);
