import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * A machine credential for server-to-server management calls.
 *
 * This is a FOURTH identity realm, separate from the three cookie/bearer realms:
 *
 *   end user   -> Authorization: Bearer <sessionToken>   (/api/v1)
 *   customer   -> fa_session cookie                     (/api/dashboard)
 *   operator   -> fa_admin_session cookie                (/api/admin)
 *   API key    -> X-Api-Key header                       (/api/keys)
 *
 * It exists so a CUSTOMER'S OWN BACKEND can provision users and devices without
 * a browser, a cookie jar, or scraping the dashboard. A server-to-server client
 * has no business holding a session cookie.
 *
 * SECURITY MODEL
 *  - Only a SHA-256 hash of the key is stored. The plaintext is shown once, by
 *    `npm run create-api-key`, and is unrecoverable afterwards — so a database
 *    leak yields nothing that can be replayed.
 *  - There is deliberately NO HTTP endpoint that can create a key. Minting is
 *    CLI-only for the same reason admin creation is: if it were reachable over
 *    the network, any registration flaw anywhere would become a full-platform
 *    compromise. `scripts/create-api-key.mjs` is the only issuer.
 *  - `scope` is the whole authorisation model. "platform" reaches every
 *    application; "app" is pinned to exactly one `applicationId` and can only
 *    ever touch that application's users and devices.
 *
 * `applicationId` is required by convention (not by schema) when scope is "app",
 * and MUST be null for "platform" — see the CLI and `lib/api-key.ts`, which
 * refuses a malformed combination rather than trusting a half-configured row.
 */
const apiKeySchema = new Schema(
  {
    /** Operator-facing label, e.g. "ci-deploy" or "billing-sync". */
    name: {
      type: String,
      required: [true, "API key name is required."],
      trim: true,
      maxlength: 64,
    },
    /**
     * SHA-256 of the key, salted with SESSION_SECRET by `hashToken`. The
     * plaintext never touches the database and is never serialised.
     */
    keyHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
      select: false,
    },
    /** Leading characters (`fak_AbCd…`) so an operator can recognise a key. */
    keyPrefix: { type: String, required: true, maxlength: 24 },
    /** Last 4 characters — the same convention as an application secret. */
    keyFingerprint: { type: String, required: true, maxlength: 8 },
    /**
     * "platform" -> may manage EVERY application.
     * "app"      -> may manage users/devices of `applicationId` ONLY.
     */
    scope: {
      type: String,
      enum: ["platform", "app"],
      required: true,
      index: true,
    },
    /** The single application an "app"-scoped key is pinned to. */
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: "Application",
      default: null,
      index: true,
    },
    /** Absolute expiry. `null` means the key does not expire. */
    expiresAt: { type: Date, default: null },
    /** Set by `npm run create-api-key -- --revoke=<id>`. Immediate kill switch. */
    revokedAt: { type: Date, default: null },
    /** Last successful use — lets an operator spot a key nobody is using. */
    lastUsedAt: { type: Date, default: null },
    /** Best-effort attribution only; never an authorisation input. */
    lastUsedIp: { type: String, default: null, maxlength: 64 },
  },
  {
    timestamps: true,
    collection: "api_keys",
  },
);

export type ApiKey = InferSchemaType<typeof apiKeySchema>;

export type ApiKeyScope = ApiKey["scope"];

/** Shape safe to serialise. Deliberately carries no hash and no plaintext. */
export type PublicApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  keyFingerprint: string;
  scope: ApiKeyScope;
  /** The pinned application, or null for a platform key. */
  applicationId: string | null;
  /** Public `fa_...` id of the pinned application, for display. */
  applicationPublicId: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

export function toPublicApiKey(key: {
  _id: { toString(): string };
  name: string;
  keyPrefix: string;
  keyFingerprint: string;
  scope: ApiKeyScope;
  applicationId: { toString(): string } | null;
  /** Present only when the caller joined the pinned application. */
  application?: { appId: string } | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}): PublicApiKey {
  return {
    id: key._id.toString(),
    name: key.name,
    keyPrefix: key.keyPrefix,
    keyFingerprint: key.keyFingerprint,
    scope: key.scope,
    applicationId: key.applicationId ? key.applicationId.toString() : null,
    applicationPublicId: key.application?.appId ?? null,
    expiresAt: key.expiresAt ? key.expiresAt.toISOString() : null,
    revokedAt: key.revokedAt ? key.revokedAt.toISOString() : null,
    lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
    createdAt: key.createdAt.toISOString(),
  };
}

export const ApiKeyModel =
  models.ApiKey ?? model<ApiKey>("ApiKey", apiKeySchema);