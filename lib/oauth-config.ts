import "server-only";

import { ApiError, ErrorCode } from "@/lib/errors";
import { connectToDatabase } from "@/lib/mongodb";
import { decryptSecret, encryptSecret } from "@/lib/oauth-crypto";
import {
  OAUTH_PROVIDERS,
  PROVIDER_DEFINITIONS,
  type OAuthProviderId,
} from "@/lib/oauth-providers";
import { OAuthProviderModel } from "@/models/OAuthProvider";

/**
 * Operator-managed OAuth configuration.
 *
 * Reads return a SAFE shape: the client secret is never included, only a
 * masked hint. The plaintext exists solely inside `getProviderConfig`, which
 * is called by the token-exchange path and nowhere else.
 */

export type SafeProviderConfig = {
  provider: OAuthProviderId;
  label: string;
  enabled: boolean;
  clientId: string | null;
  hasSecret: boolean;
  allowCustomerLogin: boolean;
  allowAdminLogin: boolean;
  settings: Record<string, unknown>;
  updatedAt: string | null;
};

export type ProviderConfig = {
  provider: OAuthProviderId;
  clientId: string;
  clientSecret: string;
  settings: Record<string, unknown>;
};

function toSafe(
  doc: {
    provider: OAuthProviderId;
    enabled: boolean;
    clientId: string | null;
    clientSecretEncrypted: string | null;
    allowCustomerLogin: boolean;
    allowAdminLogin: boolean;
    settings?: Record<string, unknown>;
    updatedAt?: Date;
  },
): SafeProviderConfig {
  return {
    provider: doc.provider,
    label: PROVIDER_DEFINITIONS[doc.provider].label,
    enabled: doc.enabled,
    clientId: doc.clientId,
    hasSecret: Boolean(doc.clientSecretEncrypted),
    allowCustomerLogin: doc.allowCustomerLogin,
    allowAdminLogin: doc.allowAdminLogin,
    settings: (doc.settings ?? {}) as Record<string, unknown>,
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : null,
  };
}

/** Every provider with its config, defaulting to "not configured". */
export async function listProviderConfigs(): Promise<SafeProviderConfig[]> {
  await connectToDatabase();
  // `clientSecretEncrypted` is `select: false`, so it MUST be requested
  // explicitly here. Without this the field arrives as undefined, `hasSecret`
  // is always false, and every provider silently disappears from the UI.
  const docs = await OAuthProviderModel.find({})
    .select("+clientSecretEncrypted")
    .lean();
  const byId = new Map(docs.map((doc) => [doc.provider, doc]));

  return OAUTH_PROVIDERS.map((id) => {
    const doc = byId.get(id);
    if (!doc) {
      return {
        provider: id,
        label: PROVIDER_DEFINITIONS[id].label,
        enabled: false,
        clientId: null,
        hasSecret: false,
        allowCustomerLogin: true,
        allowAdminLogin: false,
        settings: {},
        updatedAt: null,
      };
    }
    return toSafe(doc);
  });
}

/** Providers usable by the given realm, for rendering the button row. */
export async function listEnabledProviders(
  realm: "customer" | "admin",
): Promise<Array<{ provider: OAuthProviderId; label: string }>> {
  await connectToDatabase();
  const field = realm === "admin" ? "allowAdminLogin" : "allowCustomerLogin";
  // Must select the secret explicitly (it is `select: false`) for the
  // "fully configured" check below to be accurate.
  const docs = await OAuthProviderModel.find({ enabled: true, [field]: true })
    .select("+clientSecretEncrypted")
    .lean();

  return docs
    // A provider with no client id is unusable; never render a dead button.
    .filter((doc) => Boolean(doc.clientId) && Boolean(doc.clientSecretEncrypted))
    .map((doc) => ({
      provider: doc.provider as OAuthProviderId,
      label: PROVIDER_DEFINITIONS[doc.provider as OAuthProviderId].label,
    }));
}

/**
 * Fetch the decrypted config for a provider.
 * Throws if disabled, unconfigured, or the secret is missing.
 */
export async function getProviderConfig(
  provider: OAuthProviderId,
  realm: "customer" | "admin",
): Promise<ProviderConfig> {
  await connectToDatabase();
  const field = realm === "admin" ? "allowAdminLogin" : "allowCustomerLogin";

  const doc = await OAuthProviderModel.findOne({ provider })
    .select("+clientSecretEncrypted")
    .lean();

  if (!doc) {
    throw new ApiError(404, ErrorCode.VALIDATION_ERROR, "Provider is not configured.");
  }
  if (!doc.enabled) {
    throw new ApiError(404, ErrorCode.VALIDATION_ERROR, "Provider is disabled.");
  }
  if (!doc[field]) {
    throw new ApiError(
      403,
      ErrorCode.FORBIDDEN,
      "This provider is not available for that sign-in method.",
    );
  }
  if (!doc.clientId || !doc.clientSecretEncrypted) {
    throw new ApiError(
      404,
      ErrorCode.VALIDATION_ERROR,
      "Provider is enabled but not fully configured.",
    );
  }

  let clientSecret: string;
  try {
    clientSecret = decryptSecret(doc.clientSecretEncrypted);
  } catch {
    // Almost always means SESSION_SECRET was rotated after this was saved.
    throw new ApiError(
      500,
      ErrorCode.INTERNAL_ERROR,
      "Stored provider secret could not be decrypted. Re-save the secret.",
    );
  }

  return {
    provider,
    clientId: doc.clientId,
    clientSecret,
    settings: (doc.settings ?? {}) as Record<string, unknown>,
  };
}

export type UpdateProviderInput = {
  enabled?: boolean;
  clientId?: string | null;
  clientSecret?: string | null;
  allowCustomerLogin?: boolean;
  allowAdminLogin?: boolean;
  settings?: Record<string, unknown>;
};

/** Create or update a provider record. Called only from the admin API. */
export async function updateProviderConfig(
  provider: OAuthProviderId,
  input: UpdateProviderInput,
  updatedBy: string,
): Promise<SafeProviderConfig> {
  await connectToDatabase();

  const update: Record<string, unknown> = { updatedBy };
  if (input.enabled !== undefined) update.enabled = input.enabled;
  if (input.clientId !== undefined) update.clientId = input.clientId || null;
  if (input.allowCustomerLogin !== undefined) {
    update.allowCustomerLogin = input.allowCustomerLogin;
  }
  if (input.allowAdminLogin !== undefined) update.allowAdminLogin = input.allowAdminLogin;
  if (input.settings !== undefined) update.settings = input.settings;

  // A blank secret field in the UI means "leave the stored secret alone".
  if (input.clientSecret) {
    update.clientSecretEncrypted = encryptSecret(input.clientSecret);
  }

  const doc = await OAuthProviderModel.findOneAndUpdate(
    { provider },
    { $set: update },
    { upsert: true, returnDocument: "after" },
  )
    .select("+clientSecretEncrypted")
    .lean();

  if (!doc) throw ApiError.internal("Failed to save provider configuration.");
  return toSafe(doc);
}

