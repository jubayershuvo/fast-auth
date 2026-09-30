import { NextResponse } from "next/server";

import { apiSuccess, handleApiError } from "@/lib/api-response";
import { getAdminIdentity } from "@/lib/admin-session";

/**
 * GET /api/admin/auth/me
 *
 * Returns the signed-in operator, or 401. Used by the admin panel to confirm
 * the session is still valid.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const admin = await getAdminIdentity();
    if (!admin) {
      return NextResponse.json(
        { success: false, error: "UNAUTHORIZED", message: "Not signed in." },
        { status: 401 },
      );
    }
    return apiSuccess(admin);
  } catch (error) {
    return handleApiError(error);
  }
}
