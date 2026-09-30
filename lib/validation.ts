import { z } from "zod";

import { MAX_PASSWORD_BYTES } from "@/lib/password";

/**
 * Input validation.
 *
 * Everything crossing the network boundary is parsed here BEFORE it reaches a
 * service or the database. Zod strips unknown keys by default, which also
 * stops a client from mass-assignment of fields like `isBanned` via the
 * register/login endpoints.
 */

/** Password policy: length-first, then a character-class mix. */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be at most 128 characters.")
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= MAX_PASSWORD_BYTES,
    "Password is too long.",
  )
  .regex(/[a-z]/, "Password must contain a lowercase letter.")
  .regex(/[A-Z]/, "Password must contain an uppercase letter.")
  .regex(/[0-9]/, "Password must contain a number.");

/**
 * A person's display name.
 *
 * Deliberately permissive about characters: real names contain spaces,
 * apostrophes, hyphens and non-Latin scripts, so the same `[a-z0-9_.-]` rule
 * used for usernames would reject them. Only the length is bounded, and control
 * characters are stripped so a name cannot corrupt logs or the UI.
 *
 * Required for both account types, but see the read fallbacks in
 * toPublicUser / toPublicAppUser: documents written before this field existed
 * have no value, and must never render as a blank.
 */
export const nameSchema = z
  .string()
  .transform((value) => value.replace(/[\u0000-\u001F\u007F]/g, "").trim())
  .pipe(z.string().min(1, "Name is required.").max(80, "Name must be at most 80 characters."));

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Email is required.")
  .max(254, "Email is too long.")
  .pipe(z.email("Enter a valid email address."));

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Username must be at least 3 characters.")
  .max(32, "Username must be at most 32 characters.")
  .regex(
    /^[a-z0-9_.-]+$/,
    "Use only letters, numbers, dots, dashes and underscores.",
  );

// ---------------------------------------------------------------------------
// Application-user credentials — the v1 realm
// ---------------------------------------------------------------------------

/**
 * An end user's login handle, for a CUSTOMER's application.
 *
 * Deliberately far more permissive than `usernameSchema`, which continues to
 * govern dashboard accounts. An app-user belongs to the customer's own product:
 * a Steam ID, an email address, a UUID, an opaque 64-char token, a unicode
 * handle, a device serial — the customer's backend decides what its players'
 * identifiers look like, and forcing `[a-z0-9_.-]{3,32}` on them would reject
 * perfectly legitimate game accounts for no security benefit. The customer
 * already holds the app secret, so the identifier format is their business.
 *
 * What is NOT relaxed, and why each one matters:
 *
 *  - non-empty after trimming. An empty handle is not a credential; it would
 *    make "sign in as nobody" a real account.
 *  - a length bound. The handle is stored and sits in the per-application
 *    unique index, so it cannot be unbounded.
 *  - control characters stripped. The handle is denormalised onto audit-log
 *    rows, and an embedded newline there can corrupt or forge a log line.
 *  - case folded. This is NORMALISATION, not restriction: it keeps sign-in
 *    agreeing with the (applicationId, username) unique index, and folding is
 *    what lets an existing account keep working when the customer changes the
 *    capitalisation a player types.
 */
export const appUserUsernameSchema = z
  .string()
  .transform((value) => value.replace(/[\u0000-\u001F\u007F]/g, "").trim())
  .pipe(
    z
      .string()
      .min(1, "Username is required.")
      .max(254, "Username must be at most 254 characters."),
  )
  .transform((value) => value.toLowerCase());

/**
 * An end user's password, for a CUSTOMER's application.
 *
 * As permissive as the customer's backend needs: no length minimum beyond
 * "not empty", and no character-class rules at all. A hardware-generated HWID,
 * a single character, or an emoji passphrase are all legitimate here.
 *
 * THE 72-BYTE CAP IS NOT A POLICY CHOICE AND MUST NOT BE RELAXED. bcrypt
 * silently truncates its input at 72 bytes, so without a matching cap any two
 * passwords sharing their first 72 bytes would hash identically and be
 * interchangeable — a real authentication bypass, not a theoretical one. It is
 * enforced in BYTES, not characters, because bytes are what bcrypt counts:
 * 30 emoji are 120 bytes and would silently become the first 12 emoji.
 *
 * Note what is deliberately absent: no `.trim()`. A password must be stored and
 * compared verbatim, so trimming it would quietly change the credential the
 * customer set. Whitespace-only is rejected as empty, but leading and trailing
 * spaces inside a real password are the customer's business.
 */
export const appUserPasswordSchema = z
  .string()
  .min(1, "Password is required.")
  .refine((value) => value.trim().length > 0, "Password is required.")
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= MAX_PASSWORD_BYTES,
    "Password is too long.",
  );

/** An ObjectId-shaped string, validated before it ever hits Mongo. */
export const objectIdSchema = z
  .string()
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid identifier.");

/** The public app id format we generate: `fa_<base64url>`. */
export const appIdSchema = z
  .string()
  .trim()
  .regex(/^fa_[A-Za-z0-9_-]{16}$/, "Invalid application id.");

/**
 * Expiration input. Either a concrete ISO date, or "lifetime"/null for no
 * expiry. A "days" number is deliberately NOT accepted here — the API always
 * stores an absolute instant so the server, not the client, decides "now".
 */
export const expirationSchema = z
  .union([
    z.iso.datetime({ message: "Expiration must be a valid ISO-8601 datetime." }),
    z.literal("lifetime"),
    z.null(),
  ])
  .transform((value) =>
    value === "lifetime" || value === null ? null : new Date(value),
  );

// ---------------------------------------------------------------------------
// Dashboard auth
// ---------------------------------------------------------------------------

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * A 6-digit emailed code.
 *
 * `.trim()` because people paste codes out of an email client, and
 * `.length(6)` because a truncated paste must be rejected with a clear message
 * rather than silently padded into a DIFFERENT (and wrong) code.
 */
export const verificationCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code from the email.");

/** Requesting a resend of the registration verification code. */
export const resendVerificationSchema = z.object({
  email: emailSchema,
});

/** Confirming a registration with the emailed code. */
export const verifyEmailSchema = z.object({
  email: emailSchema,
  code: verificationCodeSchema,
});

/**
 * Step 1 of claiming a password for an account that has none.
 *
 * Deliberately takes ONLY an email: no password yet, because the password is
 * stored in the second step, after the code proves the requester owns the
 * mailbox.
 */
export const requestPasswordSetupSchema = z.object({
  email: emailSchema,
});

/** Step 2: the code plus the password to store. */
export const setPasswordWithCodeSchema = z.object({
  email: emailSchema,
  code: verificationCodeSchema,
  password: passwordSchema,
});

/**
 * Forgot password, step 1.
 *
 * Identical in shape to `requestPasswordSetupSchema` on purpose: the two flows
 * are the same act from the requester's side — "I cannot sign in" — so a client
 * (and the shared form component) can treat them identically.
 */
/**
 * Forgot password, step 1 — which account?
 *
 * `identifier` rather than `email` because people forget which of the two they
 * signed up with, and the sign-in screen already accepts either. It is
 * deliberately NOT validated as an email: rejecting `mike` here would tell the
 * caller their username is malformed before the server has even looked, and
 * would make the field useless for its stated purpose.
 */
export const requestPasswordResetSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, "Enter your email or username.")
    .max(254, "That is too long to be an email or username."),
});

/**
 * Forgot password, step 2 — check the code WITHOUT spending it.
 *
 * The screen asks for the code alone before it will show the password fields, so
 * the code is validated on its own first. This does not consume the code; the
 * final confirm does, which is what keeps it single-use.
 */
export const verifyPasswordResetCodeSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  code: verificationCodeSchema,
});

/** Forgot password, step 3 — the code plus the NEW password to store. */
export const resetPasswordWithCodeSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  code: verificationCodeSchema,
  password: passwordSchema,
});

export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type RequestPasswordSetupInput = z.infer<typeof requestPasswordSetupSchema>;
export type SetPasswordWithCodeInput = z.infer<typeof setPasswordWithCodeSchema>;
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;
export type VerifyPasswordResetCodeInput = z.infer<typeof verifyPasswordResetCodeSchema>;
export type ResetPasswordWithCodeInput = z.infer<typeof resetPasswordWithCodeSchema>;

/**
 * The signed-in customer's own profile.
 *
 * Separate from `changePasswordSchema` so a name change never re-runs the
 * password policy, and a password change never needs a name.
 */
export const updateProfileSchema = z.object({
  name: nameSchema,
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Accepts email or username in one field so customers sign in with either. */
export const dashboardLoginSchema = z.object({
  identifier: z.string().trim().min(3, "Enter your email or username.").max(254),
  password: z.string().min(1, "Password is required.").max(128),
});

export type DashboardLoginInput = z.infer<typeof dashboardLoginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required.").max(128),
  newPassword: passwordSchema,
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export const createApplicationSchema = z.object({
  name: z.string().trim().min(1, "Application name is required.").max(64),
  description: z.string().trim().max(280).default(""),
});

export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

export const updateApplicationSchema = z
  .object({
    name: z.string().trim().min(1, "Application name is required.").max(64).optional(),
    description: z.string().trim().max(280).optional(),
  })
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    message: "Provide at least one field to update.",
  });

export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;

/**
 * Start / Stop the whole application.
 *
 * Separate from `updateApplicationSchema` on purpose: suspending is a different
 * kind of action (it cuts live traffic) and deserves its own endpoint, its own
 * confirmation dialog and its own audit entry — not a field that slips through
 * a rename.
 */
export const setApplicationStatusSchema = z.object({
  status: z.enum(["active", "suspended"]),
});

export type SetApplicationStatusInput = z.infer<typeof setApplicationStatusSchema>;

// ---------------------------------------------------------------------------
// Application users
// ---------------------------------------------------------------------------

export const createAppUserSchema = z.object({
  name: nameSchema,
  username: appUserUsernameSchema,
  password: appUserPasswordSchema,
  maxDevices: z.coerce.number().int().min(1).max(100).default(1),
  expiresAt: expirationSchema.default(null),
  notes: z.string().trim().max(500).default(""),
});

export type CreateAppUserInput = z.infer<typeof createAppUserSchema>;

/** 8-128 chars: permissive enough for generated HWIDs, bounded for storage. */
export const deviceIdSchema = z
  .string()
  .trim()
  .min(8, "deviceId must be at least 8 characters.")
  .max(128, "deviceId must be at most 128 characters.")
  .regex(/^[A-Za-z0-9._:-]+$/, "deviceId contains unsupported characters.");

/**
 * Body for editing a registered device.
 *
 * Both fields are optional but at least one is required. `deviceId` is
 * deliberately editable here rather than being treated as immutable: owners do
 * need to correct a client that was built with a bad identifier, and the
 * alternative is deleting the device and burning a seat to re-create it.
 *
 * Changing `deviceId` is NOT free, and the UI says so — see updateDevice. It
 * reuses `deviceIdSchema` so an edited identifier can never be one that login
 * would have rejected.
 */
/**
 * Optional device name supplied by the client at login.
 *
 * Empty or whitespace-only is treated as "not supplied" rather than an error:
 * this field is optional and cosmetic, so failing a login because of a blank
 * label would be a bad trade. It then persists as `null`, which is what the
 * dashboard renders as "Unnamed device".
 */
export const deviceNameSchema = z
  .string()
  .trim()
  .max(80, "Device name must be at most 80 characters.")
  .transform((value) => (value === "" ? undefined : value))
  .optional();

/**
 * Owner-set device name in the dashboard.
 *
 * Stricter than the login variant: blanking an existing label is a no-op at
 * best, so an empty name here is a mistake worth reporting.
 */
export const deviceNameInputSchema = z
  .string()
  .trim()
  .min(1, "Device name cannot be empty.")
  .max(80, "Device name must be at most 80 characters.");

export const updateDeviceSchema = z
  .object({
    deviceName: deviceNameInputSchema.optional(),
    deviceId: deviceIdSchema.optional(),
  })
  .refine((value) => value.deviceName !== undefined || value.deviceId !== undefined, {
    message: "Provide a device name, a device id, or both.",
  });

export type UpdateDeviceInput = z.infer<typeof updateDeviceSchema>;

export const updateAppUserSchema = z
  .object({
    name: nameSchema.optional(),
    notes: z.string().trim().max(500).optional(),
    maxDevices: z.coerce.number().int().min(1).max(100).optional(),
    expiresAt: expirationSchema.optional(),
    // Same permissive rule as creation: an owner setting an end user's
    // password is subject to exactly the same constraint, so a password that
    // can be SET is always one that can be LOGGED IN with.
    password: appUserPasswordSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Provide at least one field to update.",
  });

export type UpdateAppUserInput = z.infer<typeof updateAppUserSchema>;

/**
 * Extension window.
 *  - `days` + `from: "now"`      -> clock starts today.
 *  - `days` + `from: "previous"` -> continues from the current expiry, which
 *    is how an owner restores an already-expired account for exactly the
 *    period originally granted.
 */
export const extendAppUserSchema = z.object({
  days: z.coerce.number().int().min(1).max(3650),
  from: z.enum(["now", "previous"]).default("now"),
});

export type ExtendAppUserInput = z.infer<typeof extendAppUserSchema>;

export const banAppUserSchema = z.object({
  reason: z.string().trim().max(280).default(""),
  revokeSessions: z.boolean().default(true),
});

export type BanAppUserInput = z.infer<typeof banAppUserSchema>;

export const unbanAppUserSchema = z.object({
  revokeSessions: z.boolean().default(false),
});


// ---------------------------------------------------------------------------
// v1 public auth API
// ---------------------------------------------------------------------------

export const v1LoginSchema = z.object({
  username: appUserUsernameSchema,
  // The SAME schema as creation, deliberately. Login used to allow 128
  // characters while creation capped at 72 bytes, so a password could be set
  // that sign-in would then reject. What can be set must always be what can be
  // used, and both are bounded by the same bcrypt limit.
  password: appUserPasswordSchema,
  deviceId: deviceIdSchema,
  /** Optional app-level secret for hardened deployments. */
  appSecret: z.string().trim().min(1).max(256).optional(),
  /**
   * Optional friendly label for this device, stored on first registration.
   *
   * Only applied when the device is NEW: a returning device keeps whatever
   * label the owner set in the dashboard, so a client cannot silently rename a
   * device (or wipe a name the owner typed) just by logging in again.
   */
  deviceName: deviceNameSchema,
});

export type V1LoginInput = z.infer<typeof v1LoginSchema>;

export const v1ValidateSchema = z.object({
  deviceId: deviceIdSchema.optional(),
});

export type V1ValidateInput = z.infer<typeof v1ValidateSchema>;

/**
 * Self-service password change for an end user.
 *
 * `currentPassword` is deliberately required even though the caller already
 * holds a valid session: it is the step-up check that stops a stolen session
 * from being used to take the account over permanently.
 */
export const v1ChangePasswordSchema = z.object({
  currentPassword: appUserPasswordSchema,
  // As permissive as the original: an end user must be able to move to a
  // machine-generated or single-character credential if their client requires
  // it. Still bounded by the bcrypt 72-byte cap, and by nothing else.
  newPassword: appUserPasswordSchema,
});

export type V1ChangePasswordInput = z.infer<typeof v1ChangePasswordSchema>;

// ---------------------------------------------------------------------------
// Self-service portal — an application's own end users
// ---------------------------------------------------------------------------

/**
 * Portal sign-in: which application, plus the end user's own credentials.
 *
 * `appId` is required because an end-user username is only unique WITHIN an
 * application — the same "player1" is a different account in every app — so
 * there is nothing to sign in to without knowing which one. It is the PUBLIC
 * `fa_...` id, which is not a secret; the `appSecret` stays out of this flow
 * entirely, because a person signing in on a website is not the customer's
 * backend and must not be handed the app-wide second factor.
 *
 * Username and password use the permissive app-user rules, not the dashboard's.
 */
export const portalLoginSchema = z.object({
  appId: appIdSchema,
  username: appUserUsernameSchema,
  password: appUserPasswordSchema,
});

/**
 * What an end user may change about themselves.
 *
 * ONLY the display name. `username` is the login handle and is deliberately
 * immutable here: changing it would silently orphan the account's history and
 * could collide with another account, and this endpoint is not the place to
 * build that. Ban state, expiry, device limit and notes are the OWNER's to
 * control, never the account holder's.
 */
export const portalUpdateProfileSchema = z.object({
  name: nameSchema,
});

/**
 * Change your own password. `currentPassword` is the step-up check that stops a
 * hijacked portal session from being used to take the account over for good.
 */
export const portalChangePasswordSchema = z.object({
  currentPassword: appUserPasswordSchema,
  newPassword: appUserPasswordSchema,
});

/**
 * A device document id from the portal's own device list.
 *
 * Constrained to the ObjectId shape here so a hostile value never reaches
 * Mongo — the same reason `objectIdSchema` exists.
 */
export const portalDeviceIdSchema = z
  .string()
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid device id.");

export type PortalLoginInput = z.infer<typeof portalLoginSchema>;
export type PortalUpdateProfileInput = z.infer<typeof portalUpdateProfileSchema>;
export type PortalChangePasswordInput = z.infer<typeof portalChangePasswordSchema>;

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(64).optional(),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

// ---------------------------------------------------------------------------
// API key (machine) management API
// ---------------------------------------------------------------------------

/**
 * Create an application through a PLATFORM key.
 *
 * `ownerId` is required and is the reason this route cannot be abused to take
 * over a tenant: an application always belongs to somebody, and a platform key
 * is explicitly choosing which customer to act for. The plan cap of that
 * customer still applies — the key bypasses no business rule, only the cookie.
 */
export const keyCreateApplicationSchema = z.object({
  ownerId: objectIdSchema,
  name: z.string().trim().min(1, "Application name is required.").max(64),
  description: z.string().trim().max(280).default(""),
});

export type KeyCreateApplicationInput = z.infer<
  typeof keyCreateApplicationSchema
>;

/**
 * Create a CUSTOMER ACCOUNT through a platform key.
 *
 * This is what produces the "account with no password" the user described: the
 * row is created in the same `users` collection as every self-registered
 * account, with no `passwordHash`, so sign-in answers NO_PASSWORD_SET and the
 * owner can claim one with an emailed code.
 *
 * `name` is required because the model requires it, but there is no `password`
 * field here and adding one would defeat the entire purpose.
 */
export const keyCreateUserSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  username: usernameSchema,
});

export type KeyCreateUserInput = z.infer<typeof keyCreateUserSchema>;

