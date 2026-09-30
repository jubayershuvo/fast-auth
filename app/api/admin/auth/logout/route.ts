import { apiSuccess, handleApiError } from "@/lib/api-response";
import { logoutAdmin } from "@/lib/admin-auth";

/** POST /api/admin/auth/logout — idempotent. */
export async function POST(): Promise<Response> {
  try {
    await logoutAdmin();
    return apiSuccess({ loggedOut: true });
  } catch (error) {
    return handleApiError(error);
  }
}
