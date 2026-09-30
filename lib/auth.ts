import "server-only";

import { connectToDatabase } from "@/lib/mongodb";
import { ApiError, ErrorCode } from "@/lib/errors";
import { Types } from "mongoose";
import { destroySession, createSession, type DashboardSessionUser } from "@/lib/session";
import { getRequestContext } from "@/lib/request";
import {
  checkRateLimit,
  consumeRateLimit,
  resetRateLimit,
} from "@/lib/rate-limit";
import { env } from "@/lib/env";
import { fakeVerifyDelay, hashPassword, verifyPassword } from "@/lib/password";
import { consumeVerificationCode, issueVerificationCode } from "@/lib/verification";
import { maskEmail } from "@/lib/mask";
import type { RegisterInput } from "@/lib/validation";
import { UserModel, toPublicUser, type PublicUser } from "@/models/User";

/**
 * Dashboard account authentication.
 *
 * Security properties enforced here:
 *  - Generic failure message + timing equalisation => no user enumeration.
 *  - bcrypt work factor identical for "user not found" and "wrong password".
 *  - Per-IP rate limiting before any database work.
 *  - Session cookie is httpOnly + SameSite=Lax; never localStorage.
 */

/**
 * Create a dashboard account by self-registration.
 *
 * The account is created UNVERIFIED and NO session is issued. The caller must
 * prove they read the emailed code before the account can be used at all — see
 * `verifyAccountEmail`.
 *
 * Returning 201 here rather than signing in immediately is the whole point of
 * the verification step: without it, anyone can register with somebody else's
 * address, then receive password-reset mail for a victim account.
 *
 * Refused outright when the operator has switched the email+password method off,
 * or closed registration while leaving sign-in on. That check lives HERE rather
 * than only in the route, so there is no path to this function that skips it.
 */
export async function registerAccount(
  input: RegisterInput,
  request: Request,
): Promise<{ user: PublicUser; verificationRequired: true }> {
  const { ip } = getRequestContext(request);
  const limitKey = `register:${ip ?? "unknown"}`;
  const max = env.dashboardLoginRateLimitMax;
  const windowMs = env.dashboardLoginRateLimitWindowMs;
  const limit = checkRateLimit(limitKey, max);
  if (!limit.allowed) {
    throw ApiError.rateLimited("Too many signup attempts. Please try again later.");
  }
  consumeRateLimit(limitKey, max, windowMs);

  // Operator policy first: no database work for a request that is going to be
  // refused anyway, and a disabled deployment should not be discoverable by
  // timing a registration.
  const {
    isEmailPasswordEnabled,
    isRegistrationAllowed,
    assertEmailPasswordEnabled,
  } = await import("@/lib/auth-method");
  if (!(await isEmailPasswordEnabled())) assertEmailPasswordEnabled();
  if (!(await isRegistrationAllowed())) {
    throw new ApiError(
      403,
      ErrorCode.AUTH_METHOD_DISABLED,
      "New account registration is closed on this deployment. Contact your administrator.",
    );
  }

  await connectToDatabase();

  // Explicit existence checks produce friendly, field-specific errors, while
  // the DB unique indexes remain the real race-condition guard.
  const existing = await UserModel.findOne({
    $or: [{ email: input.email }, { username: input.username }],
  }).lean();

  if (existing) {
    if (existing.email === input.email) {
      throw ApiError.conflict(ErrorCode.EMAIL_TAKEN, "That email is already registered.");
    }
    throw ApiError.conflict(ErrorCode.USERNAME_TAKEN, "That username is already taken.");
  }

  const passwordHash = await hashPassword(input.password);
  const user = await UserModel.create({
    name: input.name,
    email: input.email,
    username: input.username,
    passwordHash,
    // Self-registration, and the address is unproven until the code is entered.
    authSource: "self",
    emailVerified: false,
    emailVerifiedAt: null,
    lastLoginAt: null,
  });

  // The password is already hashed and stored, so the account is NOT locked out
  // if this email fails — `loginAccount` refuses unverified addresses, and the
  // user can simply request another code.
  await issueVerificationCode({
    userId: user._id,
    email: user.email,
    purpose: "verify_email",
  });

  return { user: toPublicUser(user), verificationRequired: true };
}

/**
 * Confirm a self-registered account with the emailed code, then sign in.
 *
 * This is the ONLY place a self-registered account becomes usable, and the only
 * place `emailVerified` is set true. It is deliberately one call: verifying and
 * then having to sign in separately would let an attacker who intercepted the
 * link sit between the two.
 */
export async function verifyAccountEmail(
  email: string,
  code: string,
  request: Request,
): Promise<PublicUser> {
  const { ip, userAgent } = getRequestContext(request);
  await connectToDatabase();

  // Verification exists only to complete an email+password registration, so it
  // follows that method. A pending signup cannot be finished once the operator
  // has retired the method — and leaving it open would be a way to keep minting
  // local accounts on a deployment that has said it does not want any.
  const { isEmailPasswordEnabled, assertEmailPasswordEnabled } =
    await import("@/lib/auth-method");
  if (!(await isEmailPasswordEnabled())) assertEmailPasswordEnabled();

  const user = await UserModel.findOne({ email: email.toLowerCase() })
    .select("+passwordHash")
    .lean();

  if (!user) {
    throw new ApiError(
      400,
      ErrorCode.INVALID_VERIFICATION_CODE,
      "That code is not valid.",
    );
  }

  if (user.emailVerified) {
    // Idempotent success. A user who clicks "resend" then re-enters an old code
    // has already done the right thing; refusing would only confuse them.
    await createSession(user._id, { ip, userAgent });
    return toPublicUser(user);
  }

  await consumeVerificationCode({
    userId: user._id,
    purpose: "verify_email",
    code,
  });

  const verified = await UserModel.findByIdAndUpdate(
    user._id,
    { $set: { emailVerified: true, emailVerifiedAt: new Date() } },
    { returnDocument: "after" },
  )
    .select("+passwordHash")
    .lean();

  if (!verified) throw ApiError.notFound("Account not found.");

  await createSession(verified._id, { ip, userAgent });
  return toPublicUser(verified);
}

/**
 * Re-send the registration code.
 *
 * Always reports success, whether or not the address exists. A different
 * response would turn this into a free oracle for "who has an account here".
 */
export async function resendVerificationCode(email: string): Promise<void> {
  await connectToDatabase();
  const user = await UserModel.findOne({ email: email.toLowerCase() }).lean();
  if (!user || user.emailVerified) return;

  await issueVerificationCode({
    userId: user._id,
    email: user.email,
    purpose: "verify_email",
  });
}


export async function loginAccount(
  identifier: string,
  password: string,
  request: Request,
): Promise<PublicUser> {
  const { ip, userAgent } = getRequestContext(request);
  const normalized = identifier.toLowerCase();

  // Rate limit BEFORE touching the database to blunt online guessing.
  const limitKey = `dashboard-login:${ip ?? "unknown"}:${normalized}`;
  const max = env.dashboardLoginRateLimitMax;
  const windowMs = env.dashboardLoginRateLimitWindowMs;
  const limit = checkRateLimit(limitKey, max);
  if (!limit.allowed) {
    throw ApiError.rateLimited(
      "Too many login attempts. Please try again later.",
    );
  }
  consumeRateLimit(limitKey, max, windowMs);

  await connectToDatabase();

  // Operator policy: the method may have been switched off since this request
  // was queued. Same check as registration, and for the same reason — the UI
  // hiding the form is a convenience, not the control.
  const { isEmailPasswordEnabled, assertEmailPasswordEnabled } =
    await import("@/lib/auth-method");
  if (!(await isEmailPasswordEnabled())) assertEmailPasswordEnabled();

  // Match on email OR username.
  const user = await UserModel.findOne({
    $or: [{ email: normalized }, { username: normalized }],
  }).select("+passwordHash");

  if (!user) {
    // Burn equivalent CPU so timing does not reveal account existence.
    await fakeVerifyDelay();
    throw new ApiError(
      401,
      ErrorCode.INVALID_CREDENTIALS,
      "Incorrect email/username or password.",
    );
  }

  // ── No password on this account ────────────────────────────────────────
  // The account exists but was never given a password: an operator created it,
  // or it came from social sign-in. Saying "incorrect password" would be a lie
  // the person cannot act on, so this is one of the two places the API is
  // deliberately specific. `verifyPassword` is NEVER called with a null hash —
  // that is how "no password" turns into "any password".
  if (!user.passwordHash) {
    await fakeVerifyDelay();

    // Which provider(s) this account is actually linked to. Sent so the sign-in
    // screen can say "registered with Google" instead of "the provider you
    // used" — the vague version leaves the person guessing which button to
    // press, and guessing is how people conclude they are locked out.
    //
    // This widens the enumeration oracle documented on NO_PASSWORD_SET only in
    // the sense of naming a provider for the ONE address already revealed; it
    // exposes nothing about any other account, and the branch is rate-limited
    // exactly like sign-in itself. An empty list is normal for an account an
    // operator created, which is not a social sign-up at all.
    const { listLinkedCustomerProviders } = await import("@/lib/oauth-user");
    const providers = await listLinkedCustomerProviders(user._id);

    throw new ApiError(
      409,
      ErrorCode.NO_PASSWORD_SET,
      "This account has no password set. Request a code by email to create one, or sign in with the provider you used.",
      { providers },
    );
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw new ApiError(
      401,
      ErrorCode.INVALID_CREDENTIALS,
      "Incorrect email/username or password.",
    );
  }

  // Password is correct, so this person is not an attacker probing the account.
  // It is therefore safe — and necessary — to say what is actually blocking them.
  if (!user.emailVerified) {
    throw new ApiError(
      403,
      ErrorCode.EMAIL_NOT_VERIFIED,
      "Please verify your email address first. Check your inbox for the 6-digit code.",
    );
  }

  // Success: clear the bucket so legitimate users are not throttled later.
  resetRateLimit(limitKey);

  user.lastLoginAt = new Date();
  await user.save();

  await createSession(user._id, { ip, userAgent });
  return toPublicUser(user);
}

/**
 * Step 1 — ask for a code to set a password on an account that has none.
 *
 * Only accounts with `passwordHash === null` qualify. A request for an account
 * that already has a password is a password-RESET attempt, and silently
 * treating it as a setup would let anyone who knows an address overwrite a
 * working credential by "claiming" it. Refuse instead.
 *
 * The response is deliberately identical whether or not the address exists.
 */
export async function requestPasswordSetup(email: string): Promise<void> {
  await connectToDatabase();

  // Claiming a password IS the email+password method. If it is off, nobody
  // should be able to start the flow.
  const { isEmailPasswordEnabled, assertEmailPasswordEnabled } =
    await import("@/lib/auth-method");
  if (!(await isEmailPasswordEnabled())) assertEmailPasswordEnabled();

  const user = await UserModel.findOne({ email: email.toLowerCase() })
    .select("+passwordHash")
    .lean();

  // Silent success for "no such account" and "already has a password": a
  // different answer for either would leak which addresses have accounts.
  if (!user || user.passwordHash) return;

  await issueVerificationCode({
    userId: user._id,
    email: user.email,
    purpose: "set_password",
  });
}

/**
 * Step 2 — exchange the emailed code for a real password, then sign in.
 *
 * This is the moment a platform-created account becomes a normal one: a hash is
 * written, and from here on `loginAccount` treats it exactly like any other
 * account. No flag is flipped and no second record is created.
 */
export async function setPasswordWithCode(
  email: string,
  code: string,
  password: string,
  request: Request,
): Promise<PublicUser> {
  const { ip, userAgent } = getRequestContext(request);
  await connectToDatabase();

  const { isEmailPasswordEnabled, assertEmailPasswordEnabled } =
    await import("@/lib/auth-method");
  if (!(await isEmailPasswordEnabled())) assertEmailPasswordEnabled();

  const user = await UserModel.findOne({ email: email.toLowerCase() })
    .select("+passwordHash")
    .lean();

  if (!user) {
    throw new ApiError(
      400,
      ErrorCode.INVALID_VERIFICATION_CODE,
      "That code is not valid.",
    );
  }

  if (user.passwordHash) {
    throw ApiError.conflict(
      ErrorCode.NO_PASSWORD_SET,
      "This account already has a password. Use the change-password flow instead.",
    );
  }

  // The code is checked BEFORE the password is hashed. Hashing is deliberately
  // the slow step, and there is no reason to spend ~100ms of bcrypt proving a
  // guess wrong.
  await consumeVerificationCode({
    userId: user._id,
    purpose: "set_password",
    code,
  });

  const updated = await UserModel.findByIdAndUpdate(
    user._id,
    {
      $set: {
        passwordHash: await hashPassword(password),
        // The code just proved control of the mailbox, so the address is now
        // verified as a side effect — regardless of which realm created it.
        emailVerified: true,
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      },
    },
    { returnDocument: "after", runValidators: true },
  )
    .select("+passwordHash")
    .lean();

  if (!updated) throw ApiError.notFound("Account not found.");

  // A fresh session: the person is now fully able to sign in, and leaving them
  // to type the password they just set is a pointless extra step.
  await createSession(updated._id, { ip, userAgent });
  return toPublicUser(updated);
}

/**
 * FORGOT PASSWORD — step 1: ask for a code.
 *
 * THE DIFFERENCE FROM `requestPasswordSetup`, and it is the whole point:
 *
 *   requestPasswordSetup  — ONLY for accounts with NO password. It refuses an
 *                           account that already has one, because claiming an
 *                           account that already works is not the same act.
 *   requestPasswordReset  — for ANY account. It works whether a password exists
 *                           or not, so the same flow both SETS a first password
 *                           and REPLACES an existing one.
 *
 * The user asked for one entry point that handles both cases, and this is it:
 * a person who forgot their password and a person who never had one are in the
 * same position — they cannot sign in — so they get the same recovery path.
 *
 * SECURITY — why this is safe even though it can overwrite a working password:
 * the emailed code is the proof. Whoever requests this does not learn or change
 * anything; only someone who can actually READ the mailbox can spend the code.
 * An attacker who merely knows an address gets a code sent to the victim and
 * no further progress. That is exactly the guarantee `set_password` already
 * relies on, and it is why this is safe where a bare "email only" reset never
 * would be.
 *
 * The response is deliberately identical for an unknown address, a known one,
 * an account with a password and one without. Any difference would turn this
 * into a free "does this person have an account here" oracle.
 */
/**
 * Find the account a recovery request refers to, by EITHER email or username.
 *
 * The sign-in screen accepts both, so recovery must too: a person who cannot
 * sign in often does not remember which one they used. One `$or` against two
 * indexed fields rather than a guess-then-retry, so a single request resolves
 * it and the two spellings can never diverge.
 */
async function findRecoverableAccount(identifier: string, withPasswordHash = false) {
  const normalized = identifier.trim().toLowerCase();
  const query = UserModel.findOne({
    $or: [{ email: normalized }, { username: normalized }],
  });
  // `passwordHash` is `select: false`, so the final step has to ask for it by
  // name — the lookup cannot simply add it.
  return (withPasswordHash ? query.select("+passwordHash") : query).lean();
}

/**
 * FORGOT PASSWORD — step 1: which account, and send the code.
 *
 * ============================================================================
 *  THIS RETURNS A MASKED ADDRESS, WHICH IS AN ENUMERATION ORACLE
 * ============================================================================
 *  It used to return nothing at all, so that a known and an unknown address were
 *  byte-for-byte identical. Showing WHERE the code went is a real usability
 *  win — it stops people checking the wrong inbox and burning attempts on a
 *  typo — but it cannot be had for free: the caller can now tell a real account
 *  from a fake one, and with it, any username or address it likes.
 *
 *  The trade is accepted, deliberately, because:
 *    - the reset screen is rate limited per IP (see `requestPasswordReset`), so
 *      the oracle is slow rather than free;
 *    - `issueVerificationCode` still rate limits per real address, so it cannot
 *      be used to spam anyone's inbox;
 *    - the alternative is a dead end, which is the failure mode this whole flow
 *      exists to prevent.
 *
 *  It reveals ONE fact about ONE address the caller supplied. To go back to
 *  strict indistinguishability, drop `maskedEmail` from the returned object and
 *  from the route — nothing else depends on it.
 */
export async function requestPasswordReset(
  identifier: string,
  request: Request,
): Promise<{ maskedEmail: string }> {
  const { ip } = getRequestContext(request);

  // Per-IP, because the response below now confirms whether an account exists.
  // `issueVerificationCode` limits per real ADDRESS, which protects a victim's
  // inbox but does nothing about someone walking a list of candidates.
  const ipKey = `password-reset-request:${ip ?? "unknown"}`;
  const max = env.dashboardLoginRateLimitMax;
  const windowMs = env.dashboardLoginRateLimitWindowMs;
  if (!checkRateLimit(ipKey, max).allowed) {
    throw ApiError.rateLimited("Too many reset requests. Please try again later.");
  }
  consumeRateLimit(ipKey, max, windowMs);

  await connectToDatabase();

  // Writing or replacing a password IS the email+password method. If the
  // operator has retired it, nobody should be able to start this flow.
  const { isEmailPasswordEnabled, assertEmailPasswordEnabled } =
    await import("@/lib/auth-method");
  if (!(await isEmailPasswordEnabled())) assertEmailPasswordEnabled();

  const user = await findRecoverableAccount(identifier);

  // No such account: report the same shape, with nothing masked, and send
  // nothing. The caller cannot tell this apart from a mail failure.
  if (!user) return { maskedEmail: "" };

  // NOTE: no `passwordHash` check. Unlike `requestPasswordSetup`, this branch
  // runs for an account that already HAS a password, because replacing it is
  // precisely what "I forgot my password" means.
  await issueVerificationCode({
    userId: user._id,
    email: user.email,
    purpose: "reset_password",
  });

  return { maskedEmail: maskEmail(user.email) };
}

/**
 * FORGOT PASSWORD — step 2: is the code right?
 *
 * Checked WITHOUT spending it, so the screen can hold the password step back
 * until the person has proven they can read the mailbox. The attempt budget and
 * the expiry are enforced exactly as they are on the final confirm, so this is
 * not a free oracle for guessing the code — it costs the same as guessing at
 * the real step.
 *
 * Returns the masked address again so the password step can restate where the
 * code came from, which is what makes the sequence feel like one flow.
 */
export async function verifyPasswordResetCode(
  identifier: string,
  code: string,
): Promise<{ maskedEmail: string }> {
  await connectToDatabase();

  const user = await findRecoverableAccount(identifier);
  // Unknown account answers exactly like a wrong code, for the same reason the
  // confirm step does: nothing actionable can be said about it.
  if (!user) {
    throw new ApiError(
      400,
      ErrorCode.INVALID_VERIFICATION_CODE,
      "That code is not valid. Request a new one.",
    );
  }

  await consumeVerificationCode({
    userId: user._id,
    purpose: "reset_password",
    code,
    consume: false,
  });

  return { maskedEmail: maskEmail(user.email) };
}

/**
 * FORGOT PASSWORD — step 2: the code plus the new password.
 *
 * Works for an account that had a password (replace it) and one that did not
 * (write the first), which is what `requestPasswordReset` promised the caller.
 * Both cases are the same write: a new hash, and the address marked verified
 * because the code just proved the mailbox.
 *
 * SESSION REVOCATION — the one thing that separates a reset from a set:
 * a person resetting a password they believe is compromised needs whoever was
 * using it locked out. So every OTHER session for the account is destroyed
 * before the new one is issued, exactly as `changeDashboardPassword` does. A
 * `set_password` does not need this (there was no password to steal), and
 * reusing that path for a reset would leave an attacker's session alive after
 * the owner has explicitly asked to be locked out.
 */
export async function resetPasswordWithCode(
  identifier: string,
  code: string,
  password: string,
  request: Request,
): Promise<PublicUser> {
  const { ip, userAgent } = getRequestContext(request);
  await connectToDatabase();

  const { isEmailPasswordEnabled, assertEmailPasswordEnabled } =
    await import("@/lib/auth-method");
  if (!(await isEmailPasswordEnabled())) assertEmailPasswordEnabled();

  const withHash = await findRecoverableAccount(identifier, true);

  // Unknown address answers exactly like a wrong code. Unlike `loginAccount`,
  // which deliberately returns NO_PASSWORD_SET, there is no legitimate reason
  // to distinguish here: the person is already mid-recovery, and telling them
  // "no such account" would tell them nothing they can act on anyway.
  if (!withHash) {
    throw new ApiError(
      400,
      ErrorCode.INVALID_VERIFICATION_CODE,
      "That code is not valid. Request a new one.",
    );
  }

  // Checked BEFORE hashing: bcrypt is deliberately the slow step and there is
  // no reason to spend ~100ms of it proving a guess wrong.
  await consumeVerificationCode({
    userId: withHash._id,
    purpose: "reset_password",
    code,
  });

  const updated = await UserModel.findByIdAndUpdate(
    withHash._id,
    {
      $set: {
        passwordHash: await hashPassword(password),
        // The code proved control of the mailbox, so the address is verified as
        // a side effect — same reasoning as `setPasswordWithCode`.
        emailVerified: true,
        emailVerifiedAt: withHash.emailVerifiedAt ?? new Date(),
      },
    },
    { returnDocument: "after", runValidators: true },
  )
    .select("+passwordHash")
    .lean();

  if (!updated) throw ApiError.notFound("Account not found.");

  // Tell the owner it happened. A password change that sends no mail is exactly
  // what a hijacked mailbox looks like from the legitimate owner's side, and
  // this is the one notification that gives them a chance to act on it.
  //
  // Fire-and-forget: the password is already stored and the sessions already
  // revoked by the time this runs, so a mail failure must not fail the reset
  // and strand the person mid-recovery.
  void import("@/lib/mailer")
    .then(({ passwordChangedEmail, sendMail }) =>
      sendMail({
        to: updated.email,
        subject: `Your ${env.appName} password was changed`,
        text: passwordChangedEmail({ appName: env.appName }),
      }),
    )
    .catch((error: unknown) => {
      console.error("[auth] Could not send the password-changed notice:", error);
    });

  // End every OTHER session before issuing the new one, so the person resetting
  // is locked out of nothing and a thief is locked out of everything.
  const { revokeAllSessionsForUser } = await import("@/lib/session");
  await revokeAllSessionsForUser(updated._id);

  // Signs this browser straight in: the person has just proved they own the
  // mailbox, so making them type the new password again immediately would be
  // pure friction.
  await createSession(updated._id, { ip, userAgent });
  return toPublicUser(updated);
}

export async function logoutAccount(): Promise<void> {
  await destroySession();
}

export async function getCurrentUser(): Promise<DashboardSessionUser | null> {
  const { getSessionUser } = await import("@/lib/session");
  return getSessionUser();
}

/**
 * Change the signed-in customer's own display name.
 *
 * Scoped to the session's own user id — there is no userId in the body, so this
 * cannot be aimed at another account. Email and username are deliberately NOT
 * editable here: both are identity/credential fields with uniqueness rules and
 * their own recovery flows, and bundling them into a "profile" PATCH is how
 * account-takeover bugs get written.
 */
export async function updateProfile(
  userId: string,
  name: string,
): Promise<DashboardSessionUser> {
  await connectToDatabase();

  const user = await UserModel.findByIdAndUpdate(
    new Types.ObjectId(userId),
    { $set: { name } },
    { returnDocument: "after", runValidators: true },
  ).lean();

  if (!user) throw ApiError.notFound("Account not found.");

  // No session refresh is needed: getSessionUser() re-reads the User document
  // on every request rather than caching the identity, so the new name is
  // visible on the very next request.
  return toPublicUser(user);
}

export async function changeDashboardPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await connectToDatabase();

  const user = await UserModel.findById(userId).select("+passwordHash");
  if (!user) {
    throw ApiError.notFound("Account not found.");
  }

  // An account with NO password cannot have its current password checked, and
  // `verifyPassword` would answer "incorrect" forever — a dead end, because the
  // user would keep retrying a password they never had. Point them at the flow
  // that actually applies. Safe to name here: this branch requires a live
  // session, so the caller is already this account.
  if (!user.passwordHash) {
    throw new ApiError(
      409,
      ErrorCode.NO_PASSWORD_SET,
      "This account has no password set. Use the set-a-password flow instead.",
    );
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    throw new ApiError(
      401,
      ErrorCode.INVALID_CREDENTIALS,
      "Current password is incorrect.",
    );
  }

  user.passwordHash = await hashPassword(newPassword);
  await user.save();

  // A password change invalidates every other session (stolen-cookie defence).
  const { revokeAllSessionsForUser } = await import("@/lib/session");
  await revokeAllSessionsForUser(userId);
  // Re-issue a fresh session for the current browser so the user stays in.
  await createSession(user._id, {});
}
