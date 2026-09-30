import { NextResponse } from "next/server";

import { apiSuccess, handleApiError } from "@/lib/api-response";
import { extractBearerToken, refreshSession, requireAppIdHeader } from "@/lib/v1-auth";

/**
 * POST /api/v1/auth/refresh  —  extend the caller's session.
 *
 * Headers:
 *   Authorization: Bearer <sessionToken>
 *   X-App-Id: fa_...
 *
 * Body: {} (nothing)
 *
 * Success (200):
 *   { "success": true, "data": { "expiresAt": "..." } }
 *
 * Failure: 401 SESSION_EXPIRED / SESSION_REVOKED / UNAUTHORIZED,
 *           503 APP_SUSPENDED while the application is stopped.
 *
 * The token is returned UNCHANGED — there is nothing to store. Call this
 * shortly before `expiresAt` to keep an active user signed in indefinitely
 * (bounded by the server's maximum session lifetime).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    // Token checked before X-App-Id, matching /validate and /me: a caller
    // missing both is unauthenticated, and 401 says that more clearly than a 400
    // complaining about a header they will send once they fix the token.
    if (!extractBearerToken(request)) {
      return NextResponse.json(
        { success: false, error: "UNAUTHORIZED", message: "Missing bearer token." },
        { status: 401 },
      );
    }
    const appId = requireAppIdHeader(request);
    const result = await refreshSession(request, appId);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
