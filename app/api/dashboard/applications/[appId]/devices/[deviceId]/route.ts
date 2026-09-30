import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { removeDevice, updateDevice } from "@/lib/device";
import { requireApplicationOwner } from "@/lib/authorization";
import { updateDeviceSchema } from "@/lib/validation";

/**
 * PATCH /api/dashboard/applications/:appId/devices/:deviceId
 *
 * Edits a registered device: its display name and/or its deviceId.
 *
 * `deviceName` is cosmetic. `deviceId` is not — the client identifies itself by
 * that value at login, so after a change a client still sending the old id
 * registers as a NEW device and uses another seat. Sessions are left alone.
 *
 * Returns 409 if the new deviceId already belongs to another of the same user's
 * devices, since two rows sharing an identifier would collapse into one.
 */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/dashboard/applications/[appId]/devices/[deviceId]">,
): Promise<Response> {
  try {
    const { appId, deviceId } = await ctx.params;
    const body = updateDeviceSchema.parse(await readJsonBody(request));
    // Ownership first, so a tenant cannot edit another tenant's device.
    await requireApplicationOwner(appId);
    const device = await updateDevice(appId, deviceId, body);
    return apiSuccess({ device });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/dashboard/applications/:appId/devices/:deviceId
 *
 * Removes one registered device and frees its seat.
 *
 * Sessions bound to that device are revoked as part of the delete, so the
 * device stops authenticating immediately rather than keeping a session alive
 * until it expires. This is the difference from simply ignoring the device:
 * an existing token is genuinely dead, not merely unused.
 *
 * The next login from that deviceId re-registers it and consumes a seat
 * again. Use `POST /users/:userId/reset-devices` to free every seat at once.
 */
export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/dashboard/applications/[appId]/devices/[deviceId]">,
): Promise<Response> {
  try {
    const { appId, deviceId } = await ctx.params;
    // Ownership first: never let one tenant delete another's device.
    await requireApplicationOwner(appId);
    await removeDevice(appId, deviceId);
    return apiSuccess({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
