import { ApiError, ErrorCode } from "@/lib/errors";
import { connectToDatabase } from "@/lib/mongodb";
import { toObjectId } from "@/lib/authorization";
import { createApplication } from "@/lib/application";
import { UserModel, toPublicUser } from "@/models/User";
import type {
  KeyCreateApplicationInput,
  KeyCreateUserInput,
} from "@/lib/validation";

/**
 * Platform-side account and application creation for the API-key realm.
 *
 * Both helpers here are deliberately thin wrappers rather than second
 * implementations. `createApplication` already does the plan gate, the appId
 * collision retry and the "return the secret exactly once" handling;
 * duplicating that would create a second place for a plan-limit bypass to hide.
 * Likewise `createPlatformAccount` reuses the shared `User` model rather than
 * introducing a parallel account type.
 */

/**
 * The ONLY account a platform key may create, on a customer's behalf.
 *
 * Same collection, same schema, same login path as a self-registered account —
 * the single difference is that `passwordHash` is left null and `authSource` is
 * "platform". That is the whole mechanism: there is no second account type, no
 * separate table and no special-case branch in the sign-in code.
 *
 * The account is created ALREADY VERIFIED. An operator supplied the address, so
 * there is nothing for the customer to prove and nothing to make them wait for;
 * they may sign in with a social provider immediately, or claim a password with
 * an emailed code.
 */
export async function createPlatformAccount(input: KeyCreateUserInput) {
  await connectToDatabase();

  const existing = await UserModel.findOne({
    $or: [{ email: input.email }, { username: input.username }],
  })
    .select("+passwordHash")
    .lean();

  if (existing) {
    if (existing.email === input.email) {
      throw ApiError.conflict(
        ErrorCode.EMAIL_TAKEN,
        "That email is already registered.",
      );
    }
    throw ApiError.conflict(
      ErrorCode.USERNAME_TAKEN,
      "That username is already taken.",
    );
  }

  const user = await UserModel.create({
    name: input.name,
    email: input.email,
    username: input.username,
    // NO passwordHash. This is the single fact the whole flow depends on.
    authSource: "platform",
    emailVerified: true,
    emailVerifiedAt: new Date(),
    lastLoginAt: null,
  });

  return toPublicUser(user);
}

export async function createApplicationForKey(input: KeyCreateApplicationInput) {
  await connectToDatabase();

  const owner = await UserModel.findById(
    toObjectId(input.ownerId, "owner id"),
  )
    .select("_id")
    .lean();

  if (!owner) {
    throw ApiError.validation(
      "No such customer. `ownerId` must be the ObjectId of an existing dashboard account.",
    );
  }

  return createApplication(owner._id.toString(), {
    name: input.name,
    description: input.description,
  });
}
