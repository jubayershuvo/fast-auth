import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * A one-time code emailed to prove control of an address.
 *
 * Three jobs, distinguished by `purpose`:
 *   "verify_email"  — confirm an address at self-registration, before the
 *                     account may be used at all.
 *   "set_password"  — a PLATFORM-created account has no password. Its owner
 *                     asks for one, proves the mailbox, and only then is a
 *                     password written.
 *   "reset_password"— the owner FORGOT an existing password, or is locking it
 *                     out after a suspected compromise. Unlike `set_password`
 *                     this works whether or not a password exists, so it can
 *                     write the first one or replace an existing one.
 *
 * WHY `reset_password` IS ITS OWN PURPOSE AND NOT A REUSE OF `set_password`:
 * the two are different operations with different consequences, and the purpose
 * is mixed into the stored hash. A code minted for one therefore cannot be
 * replayed as the other even when the six digits coincide, so a code obtained
 * by requesting a password SET can never be spent on a RESET, or vice versa.
 *
 * SECURITY
 *  - Only a SHA-256 hash is stored, salted with SESSION_SECRET exactly like
 *    every other token here. A database leak therefore yields no usable code.
 *  - The plaintext exists for exactly one send and is never logged, returned
 *    or persisted.
 *  - `attempts` is a hard ceiling: five wrong guesses DESTROY the code, so a
 *    6-digit space cannot be walked. A 15-minute TTL bounds the rest.
 *  - Issuing a new code revokes any earlier one for the same (user, purpose),
 *    so the most recent request is always the only one that can work.
 *  - Consumed rows are deleted rather than flagged: a used code has no audit
 *    value here, and a TTL index cannot be relied on for prompt removal.
 */
const verificationCodeSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    /** Denormalised so a lookup by address does not need a join. */
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    purpose: {
      type: String,
      enum: ["verify_email", "set_password", "reset_password"],
      required: true,
      index: true,
    },
    /** SHA-256 of the code. The plaintext is never stored. */
    codeHash: { type: String, required: true, select: false },
    expiresAt: {
      type: Date,
      required: true,
      // NOTE: no `index: true` here — declaring it both here and via
      // `schema.index()` below makes Mongoose treat the second as a duplicate
      // and drop its options, so `expireAfterSeconds: 0` is never applied and
      // the TTL silently becomes a plain index. Abandoned codes would then
      // live forever, which is exactly what the TTL below exists to prevent.
      // DashboardSession / AdminSession / Session carry the same warning.
    },
    attempts: { type: Number, default: 0 },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: "verification_codes",
  },
);

// The hot path: "the newest live code for this user and purpose".
verificationCodeSchema.index({ userId: 1, purpose: 1, createdAt: -1 });
// A TTL index reaps abandoned codes so the collection cannot grow forever.
verificationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type VerificationCode = InferSchemaType<typeof verificationCodeSchema>;

export type VerificationPurpose = VerificationCode["purpose"];

export const VerificationCodeModel =
  models.VerificationCode ??
  model<VerificationCode>("VerificationCode", verificationCodeSchema);