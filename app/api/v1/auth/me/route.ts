import { NextResponse } from "next/server";

import { apiSuccess, handleApiError } from "@/lib/api-response";
import { extractBearerToken, requireAppIdHeader, validateSession } from "@/lib/v1-auth";

/**
 * GET /api/v1/auth/me
 *
 * Headers:
 *   Authorization: Bearer <session-token>
 *   X-App-Id: fa_...
 *
 * Convenience alias returning the identity bound to the presented session,
 * so a client can display "signed in as X" without storing anything itself.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    // Fail fast with a clear message rather than a generic 401 from validate.
    if (!extractBearerToken(request)) {
      return NextResponse.json(
        { success: false, error: "UNAUTHORIZED", message: "Missing bearer token." },
        { status: 401 },
      );
    }
    const appId = requireAppIdHeader(request);
    const result = await validateSession(request, appId);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
