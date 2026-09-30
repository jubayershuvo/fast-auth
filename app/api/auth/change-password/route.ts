import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { changeDashboardPassword } from "@/lib/auth";
import { requireDashboardUser } from "@/lib/authorization";
import { changePasswordSchema, type ChangePasswordInput } from "@/lib/validation";

/**
 * POST /api/auth/change-password
 *
 * On success every other session for this account is revoked and the current
 * browser is re-issued a fresh session, so a stolen cookie cannot outlive a
 * password change.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireDashboardUser();
    const input: ChangePasswordInput = changePasswordSchema.parse(
      await readJsonBody<unknown>(request),
    );
    await changeDashboardPassword(user.id, input.currentPassword, input.newPassword);
    return apiSuccess({ updated: true });
  } catch (error) {
    return handleApiError(error);
  }
}
