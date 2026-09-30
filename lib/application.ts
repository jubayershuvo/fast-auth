import "server-only";

import { Types } from "mongoose";

import { ApiError, ErrorCode } from "@/lib/errors";
import { connectToDatabase, withOptionalTransaction } from "@/lib/mongodb";
import { assertCanCreateApplication } from "@/lib/plans";
import { toObjectId } from "@/lib/authorization";
import { generateAppId, generateAppSecret, hashToken, secretFingerprint } from "@/lib/tokens";
import { recordAuthEvent } from "@/lib/logger";
import { ApplicationModel, toPublicApplication, type ApplicationStatus, type PublicApplication } from "@/models/Application";
import { AppUserModel } from "@/models/AppUser";
import { AuthAction } from "@/models/AuthLog";
import { DeviceModel } from "@/models/Device";
import { SessionModel } from "@/models/Session";
import { AuthLogModel } from "@/models/AuthLog";
import type { CreateApplicationInput, UpdateApplicationInput } from "@/lib/validation";

/**
 * Application service.
 *
 * Every read/write takes `ownerId` from the SERVER-SIDE SESSION and includes
 * it in the query filter. There is deliberately no code path in this file that
 * accepts an ownerId from the caller, which makes cross-tenant access a
 * type-level impossibility rather than a review-time promise.
 */

export type ApplicationWithSecret = PublicApplication & {
  /** Plaintext secret. Returned exactly once, on create/rotate. */
  appSecret: string;
};

export async function listApplications(ownerId: string): Promise<PublicApplication[]> {
  await connectToDatabase();
  const applications = await ApplicationModel.find({
    ownerId: new Types.ObjectId(ownerId),
  })
    .sort({ createdAt: -1 })
    .lean();

  return applications.map(toPublicApplication);
}

export async function getApplication(
  ownerId: string,
  applicationId: string,
): Promise<PublicApplication> {
  await connectToDatabase();
  const application = await ApplicationModel.findOne({
    _id: toObjectId(applicationId, "application id"),
    ownerId: new Types.ObjectId(ownerId),
  }).lean();

  if (!application) throw ApiError.notFound("Application not found.");
  return toPublicApplication(application);
}

export async function createApplication(
  ownerId: string,
  input: CreateApplicationInput,
): Promise<ApplicationWithSecret> {
  await connectToDatabase();

  // Subscription gate: refuse before generating credentials if the account has
  // no application seats left on its current plan.
  await assertCanCreateApplication(ownerId);

  // 24 bytes of entropy -> 32 base64url chars, comfortably collision-free.
  let appId = generateAppId();
  // Defensive: regenerate on the (astronomically unlikely) collision rather
  // than surfacing a raw E11000 to the user.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const clash = await ApplicationModel.exists({ appId });
    if (!clash) break;
    appId = generateAppId();
  }

  const appSecret = generateAppSecret();

  const application = await ApplicationModel.create({
    ownerId: new Types.ObjectId(ownerId),
    name: input.name,
    description: input.description,
    appId,
    // Only the hash is persisted; the plaintext is returned once below.
    appSecretHash: hashToken(appSecret),
    appSecretFingerprint: secretFingerprint(appSecret),
    appSecretRotatedAt: new Date(),
  });

  return { ...toPublicApplication(application), appSecret };
}

export async function updateApplication(
  ownerId: string,
  applicationId: string,
  input: UpdateApplicationInput,
): Promise<PublicApplication> {
  await connectToDatabase();

  // Build the update object explicitly — never spread raw client input into
  // the query, which would allow mass-assignment of ownerId/appId.
  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.description !== undefined) update.description = input.description;

  const application = await ApplicationModel.findOneAndUpdate(
    {
      _id: toObjectId(applicationId, "application id"),
      ownerId: new Types.ObjectId(ownerId),
    },
    { $set: update },
    { returnDocument: "after", runValidators: true },
  ).lean();

  if (!application) throw ApiError.notFound("Application not found.");
  return toPublicApplication(application);
}


/**
 * Stop or start an application.
 *
 * Reversible by design. Suspending does NOT delete sessions or devices: it only
 * makes the v1 API refuse authentication. That is the difference between
 * "temporarily paused" and "wiped", and it means the owner can resume without
 * every end user having to log in again.
 *
 * Scoped by `ownerId` so one customer can never switch off another's app, even
 * if they guess an application id.
 */
export async function setApplicationStatus(
  ownerId: string,
  applicationId: string,
  status: ApplicationStatus,
): Promise<PublicApplication> {
  await connectToDatabase();

  const application = await ApplicationModel.findOneAndUpdate(
    {
      _id: toObjectId(applicationId, "application id"),
      ownerId: toObjectId(ownerId, "owner id"),
    },
    { $set: { status } },
    { returnDocument: "after" },
  ).lean();

  if (!application) throw ApiError.notFound("Application not found.");

  // Audited: "why did every login start failing at 14:02?" must be answerable
  // from the trail, not guessed at.
  await recordAuthEvent({
    applicationId: application._id.toString(),
    action: status === "suspended" ? AuthAction.APP_SUSPENDED : AuthAction.APP_RESUMED,
    success: true,
  });

  return toPublicApplication(application);
}

/**
 * Rotate the application secret.
 *
 * WARNING: this immediately invalidates the previous secret for any client
 * that sends it. The new plaintext is returned exactly once.
 */
export async function rotateApplicationSecret(
  ownerId: string,
  applicationId: string,
): Promise<ApplicationWithSecret> {
  await connectToDatabase();

  const appSecret = generateAppSecret();
  const objectId = toObjectId(applicationId, "application id");

  const application = await ApplicationModel.findOneAndUpdate(
    { _id: objectId, ownerId: new Types.ObjectId(ownerId) },
    {
      $set: {
        appSecretHash: hashToken(appSecret),
        appSecretFingerprint: secretFingerprint(appSecret),
        appSecretRotatedAt: new Date(),
      },
    },
    { returnDocument: "after", runValidators: true },
  ).lean();

  if (!application) throw ApiError.notFound("Application not found.");
  return { ...toPublicApplication(application), appSecret };
}

/**
 * Delete an application and everything scoped to it.
 *
 * Runs in a transaction when the deployment supports one. Callers order the
 * deletes children-first and the parent LAST, so even without transactions (a
 * standalone mongod) a mid-way failure leaves the application row intact and
 * the operation safely retryable.
 */
export async function deleteApplication(
  ownerId: string,
  applicationId: string,
): Promise<void> {
  await connectToDatabase();

  const appObjectId = toObjectId(applicationId, "application id");
  const ownerObjectId = new Types.ObjectId(ownerId);

  // Confirm ownership FIRST so we never cascade on someone else's data.
  const application = await ApplicationModel.findOne({
    _id: appObjectId,
    ownerId: ownerObjectId,
  }).lean();
  if (!application) throw ApiError.notFound("Application not found.");

  const scope = { applicationId: appObjectId };

  await withOptionalTransaction(async (dbSession) => {
    await Promise.all([
      SessionModel.deleteMany(scope).session(dbSession),
      DeviceModel.deleteMany(scope).session(dbSession),
      AuthLogModel.deleteMany(scope).session(dbSession),
      AppUserModel.deleteMany(scope).session(dbSession),
    ]);
    await ApplicationModel.deleteOne({ _id: appObjectId }).session(dbSession);
  });
}

/**
 * Resolve an application for the PUBLIC v1 API by its public `appId`.
 *
 * Intentionally NOT owner-scoped: end users authenticate with the appId their
 * client was built with. Security comes from the appSecret (verified
 * separately) and from this returning no owner data.
 */
export async function findApplicationByAppId(appId: string) {
  await connectToDatabase();
  return ApplicationModel.findOne({ appId }).select("+appSecretHash").lean();
}

/** Verify the app-level secret when the client supplies one. */
export async function verifyAppSecret(
  application: { appSecretHash: string },
  provided: string,
): Promise<void> {
  if (application.appSecretHash !== hashToken(provided)) {
    throw new ApiError(401, ErrorCode.INVALID_APP_SECRET, "Invalid application secret.");
  }
}

/** Audit helper for app-user lifecycle events. */
export async function logApplicationEvent(
  applicationId: string,
  username: string,
  action: "USER_CREATED" | "USER_UPDATED" | "USER_DELETED",
  reason: string,
  success = true,
): Promise<void> {
  await recordAuthEvent({ applicationId, username, action, success, reason });
}
