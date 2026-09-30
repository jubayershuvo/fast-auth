import { apiSuccess, handleApiError } from "@/lib/api-response";
import { destroyPortalSession } from "@/lib/portal-auth";

/**
 * POST /api/portal/auth/logout
 *
 * Revoke the portal session and clear the cookie. Idempotent: signing out twice,
 * or without a session, is a success.
 *
 * Only THIS browser is signed out. The user's other sessions — their game
 * clients and any other browsers — are untouched; that is what the
 * "sign out everywhere" control in the owner's dashboard is for.
 */
export async function POST(): Promise<Response> {
  try {
    await destroyPortalSession();
    return apiSuccess({ signedOut: true });
  } catch (error) {
    return handleApiError(error);
  }
}