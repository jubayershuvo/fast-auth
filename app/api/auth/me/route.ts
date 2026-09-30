import { NextResponse } from "next/server";

import { apiSuccess, handleApiError } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET /api/auth/me
 *
 * Returns the signed-in dashboard account, or 401 UNAUTHORIZED when the
 * session cookie is missing/expired/revoked. Never returns a password hash.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "UNAUTHORIZED", message: "Not signed in." },
        { status: 401 },
      );
    }
    return apiSuccess(user);
  } catch (error) {
    return handleApiError(error);
  }
}
