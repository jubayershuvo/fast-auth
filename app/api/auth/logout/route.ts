import { handleApiError, apiSuccess } from "@/lib/api-response";
import { logoutAccount } from "@/lib/auth";

/**
 * POST /api/auth/logout
 *
 * Revokes the server-side session row and clears the cookie.
 * Always returns 200 so a repeated logout is harmless.
 */
export async function POST(): Promise<Response> {
  try {
    await logoutAccount();
    return apiSuccess({ loggedOut: true });
  } catch (error) {
    return handleApiError(error);
  }
}
