import "server-only";

import { env } from "@/lib/env";
import { ApiError, ErrorCode } from "@/lib/errors";
import { connectToDatabase } from "@/lib/mongodb";
import { fakeVerifyDelay, verifyPassword } from "@/lib/password";
import { getRequestContext } from "@/lib/request";
import { checkRateLimit, consumeRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { createAdminSession, destroyAdminSession, type AdminIdentity } from "@/lib/admin-session";
import { getAdminIdentity } from "@/lib/admin-session";
import { AdminUserModel } from "@/models/AdminUser";

/**
 * Platform-admin authentication.
 *
 * Threat model: an admin session can read EVERY tenant's data, so this path is
 * treated as the highest-value target on the system:
 *   - tighter rate limiting than customer login (5 / 15 min by default);
 *   - generic error + timing equalisation, so it cannot be used to enumerate
 *     which administrator emails exist;
 *   - a distinct cookie namespace, unreachable from customer sessions.
 */

export async function loginAdmin(
  identifier: string,
  password: string,
  request: Request,
): Promise<AdminIdentity> {
  const { ip, userAgent } = getRequestContext(request);
  const normalized = identifier.toLowerCase();

  const limitKey = `admin-login:${ip ?? "unknown"}:${normalized}`;
  const max = env.adminLoginRateLimitMax;
  const windowMs = env.adminLoginRateLimitWindowMs;

  const limit = checkRateLimit(limitKey, max);
  if (!limit.allowed) {
    throw ApiError.rateLimited(
      "Too many administrator sign-in attempts. Try again later.",
    );
  }
  consumeRateLimit(limitKey, max, windowMs);

  await connectToDatabase();

  const admin = await AdminUserModel.findOne({
    $or: [{ email: normalized }, { username: normalized }],
  })
    .select("+passwordHash")
    .lean();

  if (!admin) {
    // Burn equivalent CPU so timing does not reveal which admins exist.
    await fakeVerifyDelay();
    throw new ApiError(
      401,
      ErrorCode.INVALID_CREDENTIALS,
      "Incorrect email/username or password.",
    );
  }

  const valid = await verifyPassword(password, admin.passwordHash);
  if (!valid) {
    // Deliberately identical to the "no such user" error above.
    throw new ApiError(
      401,
      ErrorCode.INVALID_CREDENTIALS,
      "Incorrect email/username or password.",
    );
  }

  resetRateLimit(limitKey);

  await AdminUserModel.updateOne(
    { _id: admin._id },
    { $set: { lastLoginAt: new Date(), lastLoginIp: ip ?? null } },
  );

  await createAdminSession(admin._id, { ip, userAgent });

  return {
    id: admin._id.toString(),
    email: admin.email,
    username: admin.username,
  };
}

export async function logoutAdmin(): Promise<void> {
  await destroyAdminSession();
}

export { getAdminIdentity };
