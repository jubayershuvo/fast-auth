import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * OAuth provider configuration (one document per provider).
 *
 * The main administrator enables a provider and pastes its client id / secret
 * from the admin panel. Customers then get working social sign-in without ever
 * configuring anything themselves.
 *
 * `clientSecretEncrypted` holds AES-256-GCM ciphertext — see
 * lib/oauth-crypto.ts for why this must be reversible rather than hashed.
 */
const oauthProviderSchema = new Schema(
  {
    provider: {
      type: String,
      required: true,
      unique: true,
      index: true,
      enum: ["google", "github", "azure"],
    },
    /** Master switch. When false the provider is invisible and unusable. */
    enabled: { type: Boolean, default: false, index: true },
    clientId: { type: String, default: null, maxlength: 512 },
    clientSecretEncrypted: { type: String, default: null, select: false },
    /**
     * Extra tenant/host config:
     *  - azure: the directory (tenant) id, e.g. "common" or a GUID.
     */
    settings: {
      type: Schema.Types.Mixed,
      default: {},
    },
    /** Which realms may use this provider. */
    allowCustomerLogin: { type: Boolean, default: true },
    allowAdminLogin: { type: Boolean, default: false },
    /** Last time an operator edited this record. */
    updatedBy: { type: String, default: null, maxlength: 254 },
  },
  { timestamps: true, collection: "oauth_providers" },
);

export type OAuthProvider = InferSchemaType<typeof oauthProviderSchema>;

export const OAuthProviderModel =
  models.OAuthProvider ??
  model<OAuthProvider>("OAuthProvider", oauthProviderSchema);
