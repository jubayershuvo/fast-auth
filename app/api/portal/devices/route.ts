import { apiSuccess, handleApiError } from "@/lib/api-response";
import { listPortalDevices } from "@/lib/portal";
import { requirePortalUser } from "@/lib/portal-auth";

/**
 * GET /api/portal/devices
 *
 * The signed-in end user's own registered devices, most recently active first.
 *
 * Scoped by the session's userId AND applicationId — there is no path parameter,
 * so it cannot be aimed at another account or another tenant.
 *
 * The portal session itself never appears here: it is not a `devices` row,
 * because a browser must never consume one of the owner's licence seats.
 *
 * Each row carries `canDelete`, computed SERVER-SIDE from the same rule the
 * DELETE endpoint enforces, so the button a person sees and the rule that
 * actually applies cannot disagree. `idleMinutes` is the configured quiet period.
 */
export async function GET(): Promise<Response> {
  try {
    const user = await requirePortalUser();
    const result = await listPortalDevices(user.id, user.applicationId);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}