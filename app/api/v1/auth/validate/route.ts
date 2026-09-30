import { NextResponse } from "next/server";

import { apiSuccess, handleApiError } from "@/lib/api-response";
import {
  extractBearerToken,
  requireAppIdHeader,
  validateSession,
} from "@/lib/v1-auth";
import { v1ValidateSchema } from "@/lib/validation";

/**
 * GET /api/v1/auth/validate  —  called on every protected request.
 *
 * Headers:
 *   Authorization: Bearer <session-token>
 *   X-App-Id: fa_...        enforce the token belongs to this app
 *
 * Query (optional):
 *   ?deviceId=device-abc    enforce the token was issued to this device
 *
 * Success: { "success": true, "data": { "valid": true, "username", ... } }
 * Failure: 401 UNAUTHORIZED / SESSION_EXPIRED / SESSION_REVOKED, or
 *           403 DEVICE_MISMATCH.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    // The token is checked before X-App-Id, matching /api/v1/auth/me. A caller
    // missing both is an unauthenticated caller, and 401 says that far more
    // clearly than a 400 complaining about a header they will send anyway once
    // they fix the token.
    if (!extractBearerToken(request)) {
      return NextResponse.json(
        { success: false, error: "UNAUTHORIZED", message: "Missing bearer token." },
        { status: 401 },
      );
    }

    const url = new URL(request.url);
    const appId = requireAppIdHeader(request);
    const { deviceId } = v1ValidateSchema.parse({
      deviceId: url.searchParams.get("deviceId") ?? undefined,
    });
    const result = await validateSession(request, appId, deviceId);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
