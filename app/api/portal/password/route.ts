import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { changePortalPassword } from "@/lib/portal";
import { requirePortalUser } from "@/lib/portal-auth";
import {
  portalChangePasswordSchema,
  type PortalChangePasswordInput,
} from "@/lib/validation";

/**
 * POST /api/portal/password
 *
 * Change the signed-in end user's own password.
 *
 * `currentPassword` is required even though the caller already holds a valid
 * portal session. That step-up check is the point: without it, a stolen portal
 * cookie would let an attacker rotate the password and lock the real owner out
 * of their account permanently.
 *
 * On success EVERY OTHER session for this user is revoked — the game clients
 * and any other browsers — so a stolen session dies the moment the owner
 * rotates. The session making this request stays valid, so nobody is logged out
 * of the page they are on.
 *
 * The password rules are the permissive app-user rules, not the dashboard's.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requirePortalUser();
    const input: PortalChangePasswordInput = portalChangePasswordSchema.parse(
      await readJsonBody<unknown>(request),
    );
    await changePortalPassword({
      userId: user.id,
      applicationId: user.applicationId,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    });
    return apiSuccess({ updated: true });
  } catch (error) {
    return handleApiError(error);
  }
}