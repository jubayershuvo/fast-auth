import { NextResponse } from "next/server";

import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { changeOwnPassword, extractBearerToken, requireAppIdHeader } from "@/lib/v1-auth";
import { v1ChangePasswordSchema } from "@/lib/validation";

/**
 * POST /api/v1/auth/password  —  change your own password.
 *
 * Headers:
 *   Authorization: Bearer <sessionToken>
 *   X-App-Id: fa_...
 *
 * Body:
 *   { "currentPassword": "...", "newPassword": "..." }
 *
 * Success (200):
 *   { "success": true, "data": { "revokedSessions": 2 } }
 *
 * Failure: 400 VALIDATION_ERROR (weak new password) / PASSWORD_UNCHANGED,
 *           401 UNAUTHORIZED / CURRENT_PASSWORD_INCORRECT,
 *           503 APP_SUSPENDED.
 *
 * Every OTHER session for this user is revoked, so a stolen token dies the
 * moment the real user changes their password. The session making the request
 * stays valid — you are not logged out of the call you just made.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    if (!extractBearerToken(request)) {
      return NextResponse.json(
        { success: false, error: "UNAUTHORIZED", message: "Missing bearer token." },
        { status: 401 },
      );
    }
    const appId = requireAppIdHeader(request);
    const input = v1ChangePasswordSchema.parse(await readJsonBody<unknown>(request));
    const result = await changeOwnPassword(request, appId, input);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
