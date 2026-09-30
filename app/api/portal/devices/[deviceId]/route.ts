import { apiSuccess, handleApiError } from "@/lib/api-response";
import { deletePortalDevice } from "@/lib/portal";
import { requirePortalUser } from "@/lib/portal-auth";
import { portalDeviceIdSchema } from "@/lib/validation";

/**
 * DELETE /api/portal/devices/{deviceId}
 *
 * Remove one of the signed-in end user's own devices, freeing a licence seat.
 *
 * THE IDLE RULE: a device must have been inactive for
 * `PORTAL_DEVICE_IDLE_MINUTES` (default 60) before it can be removed. Freeing a
 * seat is a privilege, and with no delay it would let an account churn through
 * seats at will — or delete the device it is currently using and be signed out
 * mid-request. Requiring a quiet period is also exactly when a person wants this:
 * a device abandoned last week, not the one under their hands. Set the variable
 * to 0 to disable the rule.
 *
 * A device that was active too recently is refused with
 * `409 DEVICE_STILL_ACTIVE` — its own code, because the remedy is TIME rather
 * than permission, and a generic 403 would read as "you are not allowed".
 *
 * Sessions issued on that device are revoked with it, so the holder cannot keep
 * authenticating from a device that no longer exists.
 *
 * Scoped to the session's own userId and applicationId, so another user's or
 * another tenant's device id simply does not match.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ deviceId: string }> },
): Promise<Response> {
  try {
    const user = await requirePortalUser();
    const { deviceId } = await context.params;
    const parsed = portalDeviceIdSchema.parse(deviceId);
    await deletePortalDevice(user.id, user.applicationId, parsed);
    return apiSuccess({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}