import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * Platform-wide sign-in method configuration (one document: `email_password`).
 *
 * This is the password equivalent of `OAuthProvider`. The operator can switch
 * email+password off for the entire deployment, and — because email verification
 * and password claiming both depend on delivering a code — can only switch it on
 * again once a working SMTP transport has been supplied here.
 *
 * WHY THE TOGGLE EXISTS: a deployment that only wants social sign-in has no
 * business accepting local passwords, because every local account is a
 * credential the operator must then defend, reset and breach-notify. Turning the
 * method off is the single switch that removes that whole surface.
 *
 * `smtpPasswordEncrypted` holds AES-256-GCM ciphertext — see
 * lib/oauth-crypto.ts for why this must be reversible rather than hashed: the
 * mailer needs the plaintext to authenticate to the relay.
 */
const authMethodSchema = new Schema(
  {
    method: {
      type: String,
      required: true,
      unique: true,
      index: true,
      enum: ["email_password"],
    },
    /**
     * Master switch. When false:
     *   - registration is refused
     *   - password sign-in is refused
     *   - email verification and password claiming are refused
     * EXISTING sessions and EXISTING accounts are untouched — disabling a sign-in
     * method must not lock people out of work they have already done.
     */
    enabled: { type: Boolean, default: true, index: true },
    /**
     * May customers REGISTER new local accounts, or only sign in with ones that
     * already exist? Split out from `enabled` because "we want to stop taking new
     * signups but must not lock out existing customers" is a real and common
     * state, and it is not expressible with a single switch.
     */
    allowRegistration: { type: Boolean, default: true },

    // ── SMTP transport ─────────────────────────────────────────────────────
    smtpHost: { type: String, default: null, maxlength: 253, trim: true },
    smtpPort: { type: Number, default: 587, min: 1, max: 65535 },
    /** TLS mode. `none` is for a local relay; the others negotiate STARTTLS. */
    smtpSecure: {
      type: String,
      enum: ["starttls", "ssl", "none"],
      default: "starttls",
    },
    smtpUser: { type: String, default: null, maxlength: 254, trim: true },
    smtpPasswordEncrypted: { type: String, default: null, select: false },
    /** The "From" address that verification codes are sent from. */
    mailFrom: { type: String, default: null, maxlength: 254, trim: true },

    /** Last time an operator edited this record. */
    updatedBy: { type: String, default: null, maxlength: 254 },
  },
  { timestamps: true, collection: "auth_methods" },
);

export type AuthMethod = InferSchemaType<typeof authMethodSchema>;

export const AuthMethodModel =
  models.AuthMethod ?? model<AuthMethod>("AuthMethod", authMethodSchema);