import { NextResponse } from "next/server";

import { apiSuccess, handleApiError } from "@/lib/api-response";
import {
  extractBearerToken,
  requireAppIdHeader,
  revokeOwnOtherSessions,
} from "@/lib/v1-auth";

/**
 * POST /api/v1/auth/sessions/revoke-others  —  "someone else has my account".
 *
 * Headers:
 *   Authorization: Bearer <sessionToken>
 *   X-App-Id: fa_...
 *
 * Success (200):
 *   { "success": true, "data": { "revoked": 2 } }
 *
 * Revokes every live session for this user EXCEPT the one making the request.
 * The caller's session deliberately survives: revoking it would log you out of
 * the very request you sent, which reads as a random failure.
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
    const result = await revokeOwnOtherSessions(request, appId);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
