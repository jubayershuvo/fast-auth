import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * A provider identity linked to a local account.
 *
 * A separate collection (rather than an array on the user document) so the
 * uniqueness of (provider, providerAccountId) is enforced by the database.
 * That constraint is what stops one provider identity from ever being linked
 * to two different accounts.
 */
const oauthAccountSchema = new Schema(
  {
    provider: {
      type: String,
      required: true,
      enum: ["google", "github", "azure"],
    },
    /** The provider's stable subject id, never the email (emails change). */
    providerAccountId: { type: String, required: true, maxlength: 255 },
    /** "customer" (User) or "admin" (AdminUser). */
    realm: { type: String, required: true, enum: ["customer", "admin"] },
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    email: { type: String, default: null, lowercase: true, trim: true },
    displayName: { type: String, default: null, maxlength: 200 },
    avatarUrl: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true, collection: "oauth_accounts" },
);

// One provider identity can only ever belong to one account.
oauthAccountSchema.index(
  { provider: 1, providerAccountId: 1 },
  { unique: true },
);
// Listing "which accounts use Google?".
oauthAccountSchema.index({ userId: 1, realm: 1 });

export type OAuthAccount = InferSchemaType<typeof oauthAccountSchema>;

export const OAuthAccountModel =
  models.OAuthAccount ?? model<OAuthAccount>("OAuthAccount", oauthAccountSchema);
