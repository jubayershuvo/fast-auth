import "server-only";

import { ApiError, ErrorCode } from "@/lib/errors";
import { connectToDatabase, withOptionalTransaction } from "@/lib/mongodb";
import { toObjectId } from "@/lib/authorization";
import { hashPassword, generatePassword } from "@/lib/password";
import { recordAuthEvent } from "@/lib/logger";
import { AuthAction } from "@/models/AuthLog";
import { AppUserModel, isExpired, toPublicAppUser, type PublicAppUser } from "@/models/AppUser";
import { DeviceModel } from "@/models/Device";
import { SessionModel } from "@/models/Session";
import { escapeRegExp } from "@/lib/search";
import type {
  BanAppUserInput,
  CreateAppUserInput,
  ExtendAppUserInput,
  PaginationInput,
  UpdateAppUserInput,
} from "@/lib/validation";

/**
 * Application-user service (the end-users of a customer's application).
 *
 * TENANCY: each function takes `applicationId` and ALWAYS includes it in the
 * Mongo filter. A userId alone is never sufficient to read or mutate a row,
 * which is what prevents one customer from managing another's users even when
 * they guess a valid ObjectId.
 */

export type AppUserListResult = {
  users: PublicAppUser[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export async function listAppUsers(
  applicationId: string,
  options: PaginationInput & { status?: string },
): Promise<AppUserListResult> {
  await connectToDatabase();
  const appObjectId = toObjectId(applicationId, "application id");
  const now = new Date();

  // Status filter is computed in the query, not in JS, so pagination totals
  // stay correct.
  const filter: Record<string, unknown> = { applicationId: appObjectId };
  if (options.search?.trim()) {
    // Anchored + escaped: prevents a user-supplied regex from being injected.
    // Anchored because usernames read as prefixes: "jo" should find "john".
    filter.username = { $regex: `^${escapeRegExp(options.search.trim())}`, $options: "i" };
  }
  if (options.status === "banned") filter.isBanned = true;
  if (options.status === "active") {
    filter.isBanned = false;
    filter.$or = [{ expiresAt: null }, { expiresAt: { $gt: now } }];
  }
  if (options.status === "expired") {
    // Excludes banned users so the Expired tab and the Expired counter agree,
    // and so the three tabs partition the list instead of overlapping.
    filter.isBanned = false;
    filter.expiresAt = { $ne: null, $lte: now };
  }

  const skip = (options.page - 1) * options.limit;
  const [users, total] = await Promise.all([
    AppUserModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(options.limit).lean(),
    AppUserModel.countDocuments(filter),
  ]);

  return {
    users: users.map((user) => toPublicAppUser(user, now)),
    total,
    page: options.page,
    limit: options.limit,
    totalPages: Math.max(1, Math.ceil(total / options.limit)),
  };
}

export async function getAppUser(
  applicationId: string,
  userId: string,
): Promise<PublicAppUser> {
  await connectToDatabase();
  const user = await AppUserModel.findOne({
    _id: toObjectId(userId, "user id"),
    applicationId: toObjectId(applicationId, "application id"),
  }).lean();

  if (!user) throw ApiError.notFound("User not found.");
  return toPublicAppUser(user);
}

export async function createAppUser(
  applicationId: string,
  input: CreateAppUserInput,
): Promise<PublicAppUser> {
  await connectToDatabase();
  const appObjectId = toObjectId(applicationId, "application id");

  const clash = await AppUserModel.exists({
    applicationId: appObjectId,
    username: input.username,
  });
  if (clash) {
    throw ApiError.conflict(
      ErrorCode.USERNAME_TAKEN,
      "That username already exists in this application.",
    );
  }

  // bcrypt BEFORE the insert so a slow hash never holds a DB connection.
  const passwordHash = await hashPassword(input.password);

  const user = await AppUserModel.create({
    applicationId: appObjectId,
    name: input.name,
    username: input.username,
    passwordHash,
    maxDevices: input.maxDevices,
    expiresAt: input.expiresAt,
    notes: input.notes,
    isBanned: false,
    banReason: null,
    bannedAt: null,
    lastLoginAt: null,
  });

  await recordAuthEvent({
    applicationId: appObjectId,
    userId: user._id,
    username: user.username,
    action: AuthAction.USER_CREATED,
    success: true,
  });

  return toPublicAppUser(user);
}

export async function updateAppUser(
  applicationId: string,
  userId: string,
  input: UpdateAppUserInput,
): Promise<PublicAppUser> {
  await connectToDatabase();
  const appObjectId = toObjectId(applicationId, "application id");
  const userObjectId = toObjectId(userId, "user id");

  const update: Record<string, unknown> = {};
  // Explicit allow-list: zod strips unknown keys, but this map is what actually
  // decides what is written, so a new schema field is not persisted until it is
  // added here. That is deliberate — a mass-assignment shortcut here would let
  // a caller write isBanned or passwordHash.
  if (input.name !== undefined) update.name = input.name;
  if (input.notes !== undefined) update.notes = input.notes;
  if (input.maxDevices !== undefined) update.maxDevices = input.maxDevices;
  if (input.expiresAt !== undefined) update.expiresAt = input.expiresAt;
  if (input.password !== undefined) {
    update.passwordHash = await hashPassword(input.password);
  }

  const user = await AppUserModel.findOneAndUpdate(
    { _id: userObjectId, applicationId: appObjectId },
    { $set: update },
    { returnDocument: "after", runValidators: true },
  ).lean();

  if (!user) throw ApiError.notFound("User not found.");

  // A password reset must not leave a stolen session alive. Flagged, not
  // deleted, so the client sees SESSION_REVOKED rather than a bare 401.
  if (input.password !== undefined) {
    await SessionModel.updateMany(
      { applicationId: appObjectId, userId: userObjectId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  }

  await recordAuthEvent({
    applicationId: appObjectId,
    userId: userObjectId,
    username: user.username,
    action: AuthAction.USER_UPDATED,
    success: true,
  });

  return toPublicAppUser(user);
}

/**
 * Delete a user and every artefact scoped to them.
 *
 * AuthLogs are intentionally RETAINED: the audit trail must survive deletion
 * of its subject, and `username` is denormalised onto the log for that reason.
 */
export async function deleteAppUser(applicationId: string, userId: string): Promise<void> {
  await connectToDatabase();
  const appObjectId = toObjectId(applicationId, "application id");
  const userObjectId = toObjectId(userId, "user id");

  const user = await AppUserModel.findOne({
    _id: userObjectId,
    applicationId: appObjectId,
  }).lean();
  if (!user) throw ApiError.notFound("User not found.");

  // Children first, parent last — safe with or without a transaction.
  await withOptionalTransaction(async (dbSession) => {
    await Promise.all([
      SessionModel.deleteMany({ applicationId: appObjectId, userId: userObjectId }).session(dbSession),
      DeviceModel.deleteMany({ applicationId: appObjectId, userId: userObjectId }).session(dbSession),
    ]);
    await AppUserModel.deleteOne({ _id: userObjectId }).session(dbSession);
  });

  await recordAuthEvent({
    applicationId: appObjectId,
    username: user.username,
    action: AuthAction.USER_DELETED,
    success: true,
  });
}

export type BanResult = {
  user: PublicAppUser;
  sessionsRevoked: number;
};

/**
 * Reset an end user's password to a freshly generated one.
 *
 * The plaintext is generated HERE, on the server, and returned exactly once —
 * it is never stored and never recoverable afterwards. It must not be generated
 * in the browser: a client-side generator uses a non-cryptographic PRNG, and
 * the owner never sees the value, so the account is simply locked.
 *
 * Sessions are FLAGGED, not deleted, for the same reason as device removal:
 * the client gets SESSION_REVOKED, which it can act on, instead of a generic
 * "invalid token" that looks like corruption.
 */
export async function resetAppUserPassword(
  applicationId: string,
  userId: string,
): Promise<{ user: PublicAppUser; password: string; sessionsRevoked: number }> {
  await connectToDatabase();
  const appObjectId = toObjectId(applicationId, "application id");
  const userObjectId = toObjectId(userId, "user id");

  const password = generatePassword();
  const passwordHash = await hashPassword(password);

  const user = await AppUserModel.findOneAndUpdate(
    { _id: userObjectId, applicationId: appObjectId },
    { $set: { passwordHash } },
    { returnDocument: "after", runValidators: true },
  ).lean();

  if (!user) throw ApiError.notFound("User not found.");

  // A password reset must not leave a stolen session alive.
  const result = await SessionModel.updateMany(
    { applicationId: appObjectId, userId: userObjectId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );

  await recordAuthEvent({
    applicationId: appObjectId,
    userId: userObjectId,
    username: user.username,
    action: AuthAction.PASSWORD_RESET,
    success: true,
  });

  return {
    user: toPublicAppUser(user),
    password,
    sessionsRevoked: result.modifiedCount ?? 0,
  };
}

/**
 * Ban a user.
 *
 * `revokeSessions` defaults to true: a ban that leaves live sessions running
 * would be trivially bypassed by a client that simply never re-authenticates.
 */
export async function banAppUser(
  applicationId: string,
  userId: string,
  input: BanAppUserInput,
): Promise<BanResult> {
  await connectToDatabase();
  const appObjectId = toObjectId(applicationId, "application id");
  const userObjectId = toObjectId(userId, "user id");

  const user = await AppUserModel.findOneAndUpdate(
    { _id: userObjectId, applicationId: appObjectId },
    {
      $set: {
        isBanned: true,
        banReason: input.reason || "No reason provided.",
        bannedAt: new Date(),
      },
    },
    { returnDocument: "after", runValidators: true },
  ).lean();

  if (!user) throw ApiError.notFound("User not found.");

  let revoked = 0;
  if (input.revokeSessions) {
    // Flag, do not delete. Every other revocation path in this codebase sets
    // `revokedAt`, and the reason is the client's experience: a deleted row
    // authenticates as a generic "invalid token", which reads as corruption,
    // whereas a flagged session reports SESSION_REVOKED and the client knows
    // to send the user back to the login screen.
    const result = await SessionModel.updateMany(
      { applicationId: appObjectId, userId: userObjectId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    revoked = result.modifiedCount ?? 0;
  }

  await recordAuthEvent({
    applicationId: appObjectId,
    userId: userObjectId,
    username: user.username,
    action: AuthAction.ACCOUNT_BANNED,
    success: true,
    reason: user.banReason,
  });

  return { user: toPublicAppUser(user), sessionsRevoked: revoked };
}

/** Lift a ban. Optionally kill sessions issued while the ban was in force. */
export async function unbanAppUser(
  applicationId: string,
  userId: string,
  revokeSessions: boolean,
): Promise<PublicAppUser> {
  await connectToDatabase();
  const appObjectId = toObjectId(applicationId, "application id");
  const userObjectId = toObjectId(userId, "user id");

  const user = await AppUserModel.findOneAndUpdate(
    { _id: userObjectId, applicationId: appObjectId },
    { $set: { isBanned: false, banReason: null, bannedAt: null } },
    { returnDocument: "after", runValidators: true },
  ).lean();

  if (!user) throw ApiError.notFound("User not found.");

  if (revokeSessions) {
    // Flagged, not deleted — see banAppUser for why the distinction matters.
    await SessionModel.updateMany(
      { applicationId: appObjectId, userId: userObjectId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  }

  await recordAuthEvent({
    applicationId: appObjectId,
    userId: userObjectId,
    username: user.username,
    action: AuthAction.ACCOUNT_UNBANNED,
    success: true,
  });

  return toPublicAppUser(user);
}

/**
 * Extend an account's expiration.
 *
 * `from: "now"`      -> now + days (a fresh period).
 * `from: "previous"` -> previousExpiry + days.
 *
 * The "previous" branch is what makes restoring an already-expired account
 * correct: a licence sold as "30 days from purchase" is reinstated for the
 * full 30 days, not for the 30 days that already elapsed.
 */
export async function extendAppUser(
  applicationId: string,
  userId: string,
  input: ExtendAppUserInput,
): Promise<PublicAppUser> {
  await connectToDatabase();
  const appObjectId = toObjectId(applicationId, "application id");
  const userObjectId = toObjectId(userId, "user id");

  const user = await AppUserModel.findOne({
    _id: userObjectId,
    applicationId: appObjectId,
  }).lean();
  if (!user) throw ApiError.notFound("User not found.");

  const DAY_MS = 86_400_000;
  const base =
    input.from === "previous"
      ? // A lifetime account has no anchor; fall back to now rather than error.
        (user.expiresAt ?? new Date())
      : new Date();

  const expiresAt = new Date(base.getTime() + input.days * DAY_MS);

  const updated = await AppUserModel.findOneAndUpdate(
    { _id: userObjectId, applicationId: appObjectId },
    { $set: { expiresAt } },
    { returnDocument: "after", runValidators: true },
  ).lean();

  if (!updated) throw ApiError.notFound("User not found.");

  await recordAuthEvent({
    applicationId: appObjectId,
    userId: userObjectId,
    username: updated.username,
    action: AuthAction.USER_UPDATED,
    success: true,
    reason: `EXTENDED_${input.days}D_${input.from.toUpperCase()}`,
  });

  return toPublicAppUser(updated);
}

/** Clear the expiry entirely, converting the account to a lifetime licence. */
export async function makeLifetime(
  applicationId: string,
  userId: string,
): Promise<PublicAppUser> {
  await connectToDatabase();
  const updated = await AppUserModel.findOneAndUpdate(
    {
      _id: toObjectId(userId, "user id"),
      applicationId: toObjectId(applicationId, "application id"),
    },
    { $set: { expiresAt: null } },
    { returnDocument: "after", runValidators: true },
  ).lean();
  if (!updated) throw ApiError.notFound("User not found.");
  return toPublicAppUser(updated);
}

/** Device count for the "1 / 2" display. */
export async function countUserDevices(applicationId: string, userId: string): Promise<number> {
  await connectToDatabase();
  return DeviceModel.countDocuments({
    applicationId: toObjectId(applicationId, "application id"),
    userId: toObjectId(userId, "user id"),
  });
}

/** Aggregate counters for the application overview. */
export async function getAppUserStats(applicationId: string) {
  await connectToDatabase();
  const appObjectId = toObjectId(applicationId, "application id");
  const now = new Date();

  const [total, banned, expired, active] = await Promise.all([
    AppUserModel.countDocuments({ applicationId: appObjectId }),
    AppUserModel.countDocuments({ applicationId: appObjectId, isBanned: true }),
    // Banned users are EXCLUDED here. Without this a user who is both banned
    // and expired is counted in `banned` AND in `expired`, so the four
    // dashboard numbers no longer add up to the total — and the owner cannot
    // reconcile the page. Banned is reported as banned; that is enough.
    AppUserModel.countDocuments({
      applicationId: appObjectId,
      isBanned: false,
      expiresAt: { $ne: null, $lte: now },
    }),
    AppUserModel.countDocuments({
      applicationId: appObjectId,
      isBanned: false,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    }),
  ]);
  // active + banned + expired === total, by construction. Asserted in tests.

  return { total, banned, expired, active };
}

export { isExpired };
