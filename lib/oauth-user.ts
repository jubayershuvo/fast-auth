import "server-only";

import { Types } from "mongoose";

import { ApiError, ErrorCode } from "@/lib/errors";
import { connectToDatabase } from "@/lib/mongodb";
import type { NormalizedProfile, OAuthProviderId } from "@/lib/oauth-providers";
import { OAuthAccountModel } from "@/models/OAuthAccount";
import { UserModel } from "@/models/User";
import { AdminUserModel } from "@/models/AdminUser";

/**
 * OAuth account resolution for both realms.
 *
 * ============================================================================
 *  THE TWO REALM RULES DIFFER, DELIBERATELY
 * ============================================================================
 *  CUSTOMER: may auto-provision. A first-time Google sign-in with a verified
 *  email creates a new customer account. That is what "sign up with Google"
 *  means.
 *
 *  ADMIN: may NEVER auto-provision. If an unknown Google account could become
 *  an administrator, then enabling Google for the admin panel would hand
 *  platform-wide access to every Google account on the internet. An admin must
 *  already exist (created via `npm run create-admin`) with a matching email,
 *  or the sign-in is refused.
 */

export type ResolvedIdentity = {
  id: string;
  email: string;
  username: string;
  isNewAccount: boolean;
};

const MAX_USERNAME_ATTEMPTS = 6;

/** Derive a unique, URL-safe username from the profile. */
async function allocateUsername(
  desired: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const base =
    desired
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, "")
      .slice(0, 32) || "user";
  if (!(await isTaken(base))) return base;

  for (let i = 2; i < MAX_USERNAME_ATTEMPTS; i += 1) {
    const suffix = `-${i}`;
    const candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  // Time-based fallback, so a burst of collisions cannot fail a sign-up.
  return `${base.slice(0, 22)}-${Date.now().toString(36).slice(-6)}`;
}

async function linkAccount(params: {
  provider: OAuthProviderId;
  profile: NormalizedProfile;
  realm: "customer" | "admin";
  userId: Types.ObjectId;
}): Promise<void> {
  await OAuthAccountModel.updateOne(
    { provider: params.provider, providerAccountId: params.profile.providerAccountId },
    {
      $set: {
        realm: params.realm,
        userId: params.userId,
        email: params.profile.email,
        displayName: params.profile.displayName,
        avatarUrl: params.profile.avatarUrl,
      },
    },
    { upsert: true },
  );
}

/**
 * Which providers this CUSTOMER account is already linked to.
 *
 * Used when someone signs in with a password against an account that has none,
 * so the screen can name the actual provider ("registered with Google") rather
 * than the vague "the provider you used". Naming it is the difference between
 * a message that can be acted on and one that leaves the person guessing.
 *
 * Returns provider ids only — never the provider account ids, the stored email
 * or anything else that would widen what this endpoint reveals about an
 * account. The caller intersects this with the ENABLED providers before
 * rendering anything, so a provider the operator has since switched off never
 * produces a button that cannot work.
 */
export async function listLinkedCustomerProviders(
  userId: Types.ObjectId | string,
): Promise<OAuthProviderId[]> {
  await connectToDatabase();

  const rows = await OAuthAccountModel.find({ realm: "customer", userId })
    .select("provider")
    .lean();

  // Deduplicated: the same provider can appear more than once if the person
  // linked a second identity from it, and the UI only needs to know it exists.
  return [...new Set(rows.map((row) => row.provider))];
}

/**
 * Resolve a verified provider profile to a CUSTOMER account,
 * creating one if this is a first-time sign-in.
 */
export async function resolveCustomerIdentity(
  provider: OAuthProviderId,
  profile: NormalizedProfile,
): Promise<ResolvedIdentity> {
  await connectToDatabase();

  // 1. Already linked? Reuse that account — the common case.
  const linked = await OAuthAccountModel.findOne({
    provider,
    providerAccountId: profile.providerAccountId,
    realm: "customer",
  })
    .select("userId")
    .lean();

  if (linked) {
    const user = await UserModel.findById(linked.userId).lean();
    if (user) {
      await linkAccount({ provider, profile, realm: "customer", userId: user._id });
      return {
        id: user._id.toString(),
        email: user.email,
        username: user.username,
        isNewAccount: false,
      };
    }
  }

  // 2. Not linked. Auto-linking by email is ONLY safe when the provider
  //    asserts the address is verified. Without that check, anyone able to set
  //    an unverified email at a provider could claim an existing account.
  if (profile.email && profile.emailVerified) {
    const existing = await UserModel.findOne({ email: profile.email }).lean();
    if (existing) {
      await linkAccount({ provider, profile, realm: "customer", userId: existing._id });
      return {
        id: existing._id.toString(),
        email: existing.email,
        username: existing.username,
        isNewAccount: false,
      };
    }
  }

  // 3. First time — provision a new customer account.
  const email = profile.email;
  if (!email) {
    throw new ApiError(
      400,
      ErrorCode.VALIDATION_ERROR,
      "The provider did not supply an email address. Use a username and password instead.",
    );
  }

  const username = await allocateUsername(
    profile.username ?? email.split("@")[0],
    async (candidate) => Boolean(await UserModel.exists({ username: candidate })),
  );

  // passwordHash is deliberately left unset: this is an OAuth-only account.
  const user = await UserModel.create({
    // The provider's display name is preferred, but many providers withhold it
    // (or return only a nickname) and `name` is required. Falling back to the
    // email's local part keeps OAuth sign-up working instead of failing on a
    // field the user never filled in — they can change it in Settings.
    name: profile.displayName?.trim() || email.split("@")[0] || username,
    email,
    username,
    // Set EXPLICITLY rather than relying on the schema defaults. `authSource`
    // defaults to "self" and `emailVerified` to false, so leaving them out
    // filed a social sign-up as a self-registration with an unproven address.
    // That is not cosmetic: the sign-in screen routes on these, so an OAuth
    // account was being told to go verify an email it had already proven, and
    // the operator's account list misreported where it came from.
    authSource: "oauth",
    // Mirror the PROVIDER's assertion rather than assuming true. Auto-linking
    // above only runs on a verified address, but a first-time sign-up falls
    // through here even when the provider did NOT verify the address — and
    // claiming verification in that case would be a lie the account is then
    // allowed to act on.
    emailVerified: profile.emailVerified,
    emailVerifiedAt: profile.emailVerified ? new Date() : null,
    lastLoginAt: new Date(),
  });

  await linkAccount({ provider, profile, realm: "customer", userId: user._id });

  return {
    id: user._id.toString(),
    email: user.email,
    username: user.username,
    isNewAccount: true,
  };
}

/**
 * Resolve a provider profile to an EXISTING ADMIN account.
 * Never creates one. See the header note for why.
 */
export async function resolveAdminIdentity(
  provider: OAuthProviderId,
  profile: NormalizedProfile,
): Promise<ResolvedIdentity> {
  await connectToDatabase();

  const linked = await OAuthAccountModel.findOne({
    provider,
    providerAccountId: profile.providerAccountId,
    realm: "admin",
  })
    .select("userId")
    .lean();

  if (linked) {
    const admin = await AdminUserModel.findById(linked.userId).lean();
    if (admin) {
      await linkAccount({ provider, profile, realm: "admin", userId: admin._id });
      return {
        id: admin._id.toString(),
        email: admin.email,
        username: admin.username,
        isNewAccount: false,
      };
    }
  }

  // No link yet: fall back to a PRE-EXISTING admin with a verified email.
  if (profile.email && profile.emailVerified) {
    const admin = await AdminUserModel.findOne({ email: profile.email }).lean();
    if (admin) {
      await linkAccount({ provider, profile, realm: "admin", userId: admin._id });
      return {
        id: admin._id.toString(),
        email: admin.email,
        username: admin.username,
        isNewAccount: false,
      };
    }
  }

  // A deliberate refusal, not an oversight.
  throw new ApiError(
    403,
    ErrorCode.FORBIDDEN,
    "No administrator matches this identity. Run `npm run create-admin` with the same email address first.",
  );
}

/** Linked providers for an account, for the settings page. */
export async function listLinkedAccounts(
  userId: string,
  realm: "customer" | "admin",
): Promise<Array<{ provider: string; email: string | null }>> {
  await connectToDatabase();
  const accounts = await OAuthAccountModel.find({
    userId: new Types.ObjectId(userId),
    realm,
  })
    .select("provider email")
    .lean();
  return accounts.map((account) => ({
    provider: account.provider,
    email: account.email,
  }));
}

