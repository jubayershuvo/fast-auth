import { NextResponse } from "next/server";

import { apiSuccess, handleApiError } from "@/lib/api-response";
import { extractBearerToken, listOwnSessions, requireAppIdHeader } from "@/lib/v1-auth";

/**
 * GET /api/v1/auth/sessions  —  where this account is currently signed in.
 *
 * Headers:
 *   Authorization: Bearer <sessionToken>
 *   X-App-Id: fa_...
 *
 * Success (200):
 *   { "success": true, "data": { "sessions": [...], "currentSessionId": "..." } }
 *
 * Always scoped to the CALLER's own sessions — there is no userId parameter, so
 * this route cannot be pointed at another account.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    if (!extractBearerToken(request)) {
      return NextResponse.json(
        { success: false, error: "UNAUTHORIZED", message: "Missing bearer token." },
        { status: 401 },
      );
    }
    const appId = requireAppIdHeader(request);
    const result = await listOwnSessions(request, appId);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
