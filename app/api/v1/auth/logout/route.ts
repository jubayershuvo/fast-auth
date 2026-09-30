import { apiSuccess, handleApiError } from "@/lib/api-response";
import { logoutFromApplication, readAppIdHeader } from "@/lib/v1-auth";

/**
 * POST /api/v1/auth/logout
 *
 * Headers:
 *   Authorization: Bearer <session-token>
 *   X-App-Id: fa_...        optional, scopes the revocation to one app
 *
 * Revokes ONLY the presented session. Revoking every session for a user is an
 * owner action available from the dashboard.
 *
 * Takes no body. Once appId moved to the header there was nothing left to send,
 * so the endpoint is a pure "revoke this token" call.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    // Optional here: a logout without an app scope still revokes the token,
    // which keeps a client working even if it forgets the header.
    await logoutFromApplication(request, readAppIdHeader(request) ?? undefined);
    return apiSuccess({ loggedOut: true });
  } catch (error) {
    return handleApiError(error);
  }
}
