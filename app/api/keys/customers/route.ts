import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { requirePlatformApiKey } from "@/lib/api-key";
import { createPlatformAccount } from "@/lib/api-key-application";
import { keyCreateUserSchema } from "@/lib/validation";

/**
 * POST /api/keys/customers  —  create a customer account on someone's behalf
 *
 * PLATFORM-KEY ONLY.
 *
 * This is the "platform + email register" path, and it writes into the SAME
 * `users` collection as self-registration. The only differences are that no
 * password is stored and the account is born verified:
 *
 *   authSource: "platform"   passwordHash: null   emailVerified: true
 *
 * Because there is no password, signing in with one returns
 * `409 NO_PASSWORD_SET` and the owner can claim a password with an emailed code
 * (`POST /api/auth/set-password/request`). From that moment it behaves exactly
 * like any other account — no migration, no second table.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requirePlatformApiKey(request);
    const input = keyCreateUserSchema.parse(await readJsonBody<unknown>(request));
    const user = await createPlatformAccount(input);
    return apiSuccess(
      {
        user,
        // Spelled out so an integrator does not have to infer it from
        // `hasPassword`, and so it is obvious no password was chosen for them.
        passwordSet: false,
        nextStep:
          "The account holder signs in with a social provider, or claims a password via POST /api/auth/set-password/request.",
      },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
