import "server-only";

import { ApiError, ErrorCode } from "@/lib/errors";
import { connectToDatabase } from "@/lib/mongodb";
import { decryptSecret, encryptSecret } from "@/lib/oauth-crypto";
import { AuthMethodModel } from "@/models/AuthMethod";

/**
 * Operator-managed configuration for the email+password sign-in method.
 *
 * Mirrors lib/oauth-config.ts deliberately: an operator configures every sign-in
 * method in the same place, in the same shape, with the same write-only-secret
 * convention. A second, differently-shaped configuration screen would be its own
 * source of confusion.
 *
 * THE CORE RULE — enabling requires a transport:
 *
 *   Enabling email+password is only meaningful with working email, because the
 *   method's defining feature is that it PROVES an address. Without SMTP a new
 *   account could never be verified and a platform-created account could never
 *   claim a password, so "enabled" would silently mean "everybody is locked
 *   out". So `updateAuthMethod` refuses to switch it on without a transport,
 *   exactly as the OAuth path refuses admin sign-in without a stored secret.
 *
 * The one deliberate exception: when SMTP_HOST is set in the environment that
 * counts as a transport. A deployment configured purely through env vars has
 * nothing to paste into the panel, and requiring it anyway would make the toggle
 * unusable there.
 */

export const AUTH_METHODS = ["email_password"] as const;
export type AuthMethodId = (typeof AUTH_METHODS)[number];

export type SafeAuthMethodConfig = {
  method: AuthMethodId;
  enabled: boolean;
  allowRegistration: boolean;
  smtpHost: string | null;
  smtpPort: number;
  smtpSecure: "starttls" | "ssl" | "none";
  smtpUser: string | null;
  /** Whether a password is stored. Never the password itself. */
  hasSmtpPassword: boolean;
  mailFrom: string | null;
  /**
   * True when a usable transport exists — either stored here or supplied by the
   * environment. The UI uses this to explain why Enable is refused.
   */
  mailConfigured: boolean;
  updatedAt: string | null;
};

/** The decrypted transport, for the mailer. Never leaves the server. */
export type SmtpTransport = {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  password: string | null;
  from: string;
};

/** Environment fallback, so an env-only deployment still counts as configured. */
function envTransport(): SmtpTransport | null {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number.parseInt(process.env.SMTP_PORT ?? "587", 10);
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure: port === 465,
    user: process.env.SMTP_USER?.trim() || null,
    password: process.env.SMTP_PASS?.trim() || null,
    from:
      process.env.MAIL_FROM?.trim() ||
      `no-reply@${process.env.NEXT_PUBLIC_APP_NAME?.trim() || "localhost"}`,
  };
}

function toSafe(doc: {
  method: AuthMethodId;
  enabled: boolean;
  allowRegistration: boolean;
  smtpHost: string | null;
  smtpPort: number;
  smtpSecure: "starttls" | "ssl" | "none";
  smtpUser: string | null;
  smtpPasswordEncrypted: string | null;
  mailFrom: string | null;
  updatedAt?: Date;
}): SafeAuthMethodConfig {
  return {
    method: doc.method,
    enabled: doc.enabled,
    allowRegistration: doc.allowRegistration,
    smtpHost: doc.smtpHost,
    smtpPort: doc.smtpPort,
    smtpSecure: doc.smtpSecure,
    smtpUser: doc.smtpUser,
    hasSmtpPassword: Boolean(doc.smtpPasswordEncrypted),
    mailFrom: doc.mailFrom,
    // Environment counts, so a panel toggle still works on an env-only setup.
    mailConfigured: Boolean(doc.smtpHost) || envTransport() !== null,
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : null,
  };
}

/** The stored config, or a safe default when the operator has never saved one. */
export async function listAuthMethodConfigs(): Promise<SafeAuthMethodConfig[]> {
  await connectToDatabase();
  // `smtpPasswordEncrypted` is `select: false` and MUST be requested explicitly,
  // or `hasSmtpPassword` is always false and the panel lies about what is saved.
  const doc = await AuthMethodModel.findOne({ method: "email_password" })
    .select("+smtpPasswordEncrypted")
    .lean();

  if (!doc) {
    return [
      {
        method: "email_password",
        // Default OFF, and deliberately CONSISTENT with the enable gate below.
        // The gate refuses to switch this method on without a transport,
        // because "enabled" with no mail means nobody can verify an address or
        // claim a password. Reporting `enabled: true` here for a deployment
        // that has no SMTP configured contradicted that rule on the very first
        // page load: the panel claimed a method was on that the API would have
        // refused to turn on, and registration silently produced accounts that
        // could never be completed. Defaulting to the honest answer (off, until
        // an operator configures mail and enables it) also means the default is
        // the safe one for a fresh install.
        enabled: false,
        // Registration follows the method, so it starts closed too.
        allowRegistration: false,
        smtpHost: null,
        smtpPort: 587,
        smtpSecure: "starttls",
        smtpUser: null,
        hasSmtpPassword: false,
        mailFrom: null,
        mailConfigured: envTransport() !== null,
        updatedAt: null,
      },
    ];
  }

  return [toSafe(doc)];
}

/**
 * Resolve the transport to use, or null.
 *
 * Stored configuration wins over the environment so an operator can change the
 * relay from the panel without redeploying.
 */
export async function getSmtpTransport(): Promise<SmtpTransport | null> {
  await connectToDatabase();
  const doc = await AuthMethodModel.findOne({ method: "email_password" })
    .select("+smtpPasswordEncrypted")
    .lean();

  if (!doc?.smtpHost) return envTransport();

  let password: string | null = null;
  if (doc.smtpPasswordEncrypted) {
    try {
      password = decryptSecret(doc.smtpPasswordEncrypted);
    } catch {
      // SESSION_SECRET was rotated after this was saved. Fall back to the
      // environment rather than sending with a silently empty password.
      console.error(
        "[auth-method] Stored SMTP password could not be decrypted; using the environment.",
      );
      return envTransport();
    }
  }

  return {
    host: doc.smtpHost,
    port: doc.smtpPort ?? 587,
    // `ssl` means implicit TLS (port 465); `starttls` is an opportunistic upgrade.
    secure: doc.smtpSecure === "ssl",
    user: doc.smtpUser ?? null,
    password,
    from:
      doc.mailFrom?.trim() ||
      envTransport()?.from ||
      `no-reply@${doc.smtpHost}`,
  };
}

export type UpdateAuthMethodInput = {
  enabled?: boolean;
  allowRegistration?: boolean;
  smtpHost?: string | null;
  smtpPort?: number;
  smtpSecure?: "starttls" | "ssl" | "none";
  smtpUser?: string | null;
  /** Blank means "keep the stored password". */
  smtpPassword?: string | null;
  mailFrom?: string | null;
};

/** Create or update the method. Called only from the admin API. */
export async function updateAuthMethod(
  method: AuthMethodId,
  input: UpdateAuthMethodInput,
  updatedBy: string,
): Promise<SafeAuthMethodConfig> {
  await connectToDatabase();

  const update: Record<string, unknown> = { updatedBy };

  if (input.smtpHost !== undefined) update.smtpHost = input.smtpHost?.trim() || null;
  if (input.smtpPort !== undefined) update.smtpPort = input.smtpPort;
  if (input.smtpSecure !== undefined) update.smtpSecure = input.smtpSecure;
  if (input.smtpUser !== undefined) update.smtpUser = input.smtpUser?.trim() || null;
  if (input.mailFrom !== undefined) update.mailFrom = input.mailFrom?.trim() || null;
  if (input.allowRegistration !== undefined) {
    update.allowRegistration = input.allowRegistration;
  }
  // Blank means "keep the stored secret", so an operator can toggle the method
  // without re-pasting the relay password.
  if (input.smtpPassword) {
    update.smtpPasswordEncrypted = encryptSecret(input.smtpPassword);
  }

  // ── The enable gate ─────────────────────────────────────────────────────
  // Applied AFTER the transport fields are merged, so saving credentials and
  // enabling in one request works, and a later disable/enable cycle does not
  // silently demand the password again.
  if (input.enabled !== undefined) {
    const current = await AuthMethodModel.findOne({ method })
      .select("+smtpPasswordEncrypted")
      .lean();
    // Read the host that will be in effect AFTER this save, and distinguish
    // "not supplied" from "explicitly cleared".
    //
    // `??` was wrong here: clearing the field stores `null`, and `null ?? x`
    // falls through to `x`, so the gate consulted the host the operator was
    // busy DELETING and let the method be enabled with no transport at all.
    // `"smtpHost" in update` is the only honest test — the key is present when
    // the request mentioned the field, whatever its value.
    const nextHost =
      "smtpHost" in update
        ? (update.smtpHost as string | null)
        : (current?.smtpHost ?? null);

    const hasTransport = Boolean(nextHost) || envTransport() !== null;
    if (input.enabled && !hasTransport) {
      throw ApiError.validation(
        "Save your SMTP settings before enabling email+password. Without a working mail transport nobody could verify an address or claim a password.",
      );
    }
    update.enabled = input.enabled;
  }

  const doc = await AuthMethodModel.findOneAndUpdate(
    { method },
    { $set: update },
    { upsert: true, returnDocument: "after" },
  )
    .select("+smtpPasswordEncrypted")
    .lean();

  if (!doc) throw ApiError.internal("Failed to save sign-in method configuration.");
  return toSafe(doc);
}

/**
 * Is the email+password method currently usable?
 *
 * Read on every register / login / verify / set-password call. This is the
 * authoritative check; hiding the form in the UI is a convenience, not the
 * control.
 */
export async function isEmailPasswordEnabled(): Promise<boolean> {
  await connectToDatabase();
  const doc = await AuthMethodModel.findOne({ method: "email_password" }).lean();
  // No row at all means a fresh install that has never been configured. It
  // defaults to OFF, matching `listAuthMethodConfigs` — the two must agree, or
  // the panel shows one state while the API enforces the opposite.
  return doc ? doc.enabled : false;
}

/** May new local accounts be created right now? */
export async function isRegistrationAllowed(): Promise<boolean> {
  await connectToDatabase();
  const doc = await AuthMethodModel.findOne({ method: "email_password" }).lean();
  // Same reasoning: nothing configured means nothing is open.
  if (!doc) return false;
  return doc.enabled && doc.allowRegistration;
}

/** Thrown by callers when the method is off. One message for every path. */
export function assertEmailPasswordEnabled(): void {
  throw new ApiError(
    403,
    ErrorCode.AUTH_METHOD_DISABLED,
    "Email and password sign-in is disabled on this deployment. Use one of the available sign-in methods instead.",
  );
}

export { ErrorCode };
