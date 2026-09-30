import "server-only";

import { randomInt } from "node:crypto";
import type { Types } from "mongoose";

import { ApiError, ErrorCode } from "@/lib/errors";
import { env } from "@/lib/env";
import { connectToDatabase } from "@/lib/mongodb";
import { hashToken, safeEqual } from "@/lib/tokens";
import { codeEmail, sendMail } from "@/lib/mailer";
import { checkRateLimit, consumeRateLimit } from "@/lib/rate-limit";
import { VerificationCodeModel, type VerificationPurpose } from "@/models/VerificationCode";

/**
 * Emailed one-time codes: issuing, checking, and burning.
 *
 * The two flows that use this are deliberately asymmetric:
 *
 *   verify_email  — a self-registered account cannot sign in until it is
 *                   verified. The code PROVES the address is theirs.
 *   set_password  — a platform-created account has no password. Its owner asks
 *                   for one, proves the mailbox, and only then is a hash
 *                   written. The code PROVES the requester is the real owner
 *                   and not someone who merely found the address.
 *
 * A 6-digit numeric code is used because it has to be typed on a phone. That is
 * only safe because of what surrounds it: 1,000,000 combinations, a 15-minute
 * TTL, a hard ceiling of five wrong attempts that DESTROYS the code, and a
 * per-address request limit. Any one of those alone would be too weak; together
 * they make guessing impractical — the same trade-off every OTP system makes.
 */

/** 6 digits, uniformly drawn. `randomInt` is a CSPRNG — never Math.random. */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Issue a code and email it.
 *
 * Any earlier live code for the same (user, purpose) is deleted first, so only
 * the most recent request can ever succeed. Without that, a user who requests a
 * resend would hold two valid codes and the older would still work — which is
 * exactly the confusion this avoids.
 */
export async function issueVerificationCode(params: {
  userId: Types.ObjectId | string;
  email: string;
  purpose: VerificationPurpose;
}): Promise<void> {
  const { userId, email, purpose } = params;
  await connectToDatabase();

  // Rate limited per ADDRESS, not per IP: a shared office IP must not lock out
  // one person, and an attacker rotating IPs gains nothing, because only a real
  // mailbox can complete the flow.
  const limitKey = `email-code:${purpose}:${email}`;
  const max = env.emailCodeRateLimitMax;
  if (!checkRateLimit(limitKey, max).allowed) {
    throw ApiError.rateLimited(
      "Too many codes requested. Please wait before trying again.",
    );
  }
  consumeRateLimit(limitKey, max, env.emailCodeRateLimitWindowMs);

  const code = generateCode();
  const expiresAt = new Date(Date.now() + env.emailCodeTtlMinutes * 60_000);

  // Invalidate the previous code for this purpose before issuing the new one.
  await VerificationCodeModel.deleteMany({ userId, purpose });

  await VerificationCodeModel.create({
    userId,
    email,
    purpose,
    codeHash: hashToken(`${purpose}:${code}`),
    expiresAt,
    attempts: 0,
  });

  const delivered = await sendMail({
    to: email,
    subject:
      purpose === "verify_email"
        ? `Your ${env.appName} verification code`
        : `Set your ${env.appName} password`,
    text: codeEmail({
      code,
      purpose,
      appName: env.appName,
      minutes: env.emailCodeTtlMinutes,
    }),
  });

  if (!delivered) {
    // The code is stored, but the person never received it. Surface that
    // rather than leaving them staring at an inbox that will stay empty.
    await VerificationCodeModel.deleteMany({ userId, purpose });
    throw new ApiError(
      503,
      ErrorCode.EMAIL_DELIVERY_FAILED,
      "We could not send the email. Please try again in a moment.",
    );
  }
}

/**
 * Check a submitted code.
 *
 * Bound to the USER, not the address: the caller has already resolved and
 * authorised the account by the time it gets here, and the stored hash is keyed
 * on (userId, purpose). That is why `email` is not a parameter — accepting one
 * would imply it is part of the lookup, and a caller could then be tempted to
 * trust a client-supplied address rather than the account it already proved.
 *
 * Returns quietly on success and consumes the code, so it is genuinely
 * single-use. Throws `ApiError` on every failure, with the specific reason —
 * the person submitting already has the code emailed to them, so telling them
 * "expired" versus "wrong" leaks nothing and saves a support ticket.
 */
export async function consumeVerificationCode(params: {
  userId: Types.ObjectId | string;
  purpose: VerificationPurpose;
  code: string;
  consume?: boolean;
}): Promise<void> {
  const { userId, purpose, code, consume = true } = params;
  await connectToDatabase();

  // The newest live code for this purpose. `+codeHash` because the field is
  // `select: false` — a wrong guess must not be able to skip the read.
  const record = await VerificationCodeModel.findOne({ userId, purpose })
    .sort({ createdAt: -1 })
    .select("+codeHash")
    .lean();

  if (!record) {
    throw new ApiError(
      400,
      ErrorCode.INVALID_VERIFICATION_CODE,
      "That code is not valid. Request a new one.",
    );
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    await VerificationCodeModel.deleteOne({ _id: record._id });
    throw new ApiError(
      400,
      ErrorCode.VERIFICATION_CODE_EXPIRED,
      "That code has expired. Request a new one.",
    );
  }

  if (record.attempts >= env.emailCodeMaxAttempts) {
    // Budget spent: destroy the code rather than merely refusing. Otherwise a
    // patient attacker could keep submitting indefinitely.
    await VerificationCodeModel.deleteOne({ _id: record._id });
    throw new ApiError(
      429,
      ErrorCode.TOO_MANY_CODE_ATTEMPTS,
      "Too many incorrect attempts. Request a new code.",
    );
  }

  // The code is namespaced by purpose in the hash, so a "set_password" code can
  // never be replayed as a "verify_email" one even if the digits coincide.
  const expected = hashToken(`${purpose}:${code}`);
  if (!safeEqual(record.codeHash, expected)) {
    const updated = await VerificationCodeModel.findByIdAndUpdate(
      { _id: record._id },
      { $inc: { attempts: 1 } },
      { returnDocument: "after" },
    ).lean();

    // Spending the last attempt burns the code immediately, so there is never a
    // live code sitting at the limit waiting to be walked.
    if (updated && updated.attempts >= env.emailCodeMaxAttempts) {
      await VerificationCodeModel.deleteOne({ _id: record._id });
    }

    throw new ApiError(
      400,
      ErrorCode.INVALID_VERIFICATION_CODE,
      "That code is not correct.",
    );
  }

  // Single use: consumed codes are removed, not flagged.
  //
  // Only when `consume` is set. The reset screen checks the code on its own
  // before showing the password fields, and that check must NOT spend the code
  // — the person has not chosen a new password yet, and destroying it here
  // would make them start over. Every failure path above still burns the code
  // and still counts the attempt, so skipping the delete on success does not
  // make the code any easier to guess: the budget is spent either way.
  if (consume) {
    await VerificationCodeModel.deleteOne({ _id: record._id });
  }
}
