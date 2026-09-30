import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { requireKeyedApplication } from "@/lib/api-key";
import { removeDevice, updateDevice } from "@/lib/device";
import { updateDeviceSchema } from "@/lib/validation";

/**
 * PATCH  /api/keys/applications/:appId/devices/:deviceId
 * DELETE /api/keys/applications/:appId/devices/:deviceId
 *
 * `deviceId` here is the device ROW's ObjectId, not the client-supplied
 * identifier the game sends at login — the same distinction the dashboard
 * makes, and the reason a wrong id 404s instead of silently editing a stranger.
 */
type Context = RouteContext<"/api/keys/applications/[appId]/devices/[deviceId]">;

export async function PATCH(request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId, deviceId } = await ctx.params;
    await requireKeyedApplication(request, appId);
    const input = updateDeviceSchema.parse(await readJsonBody<unknown>(request));
    const device = await updateDevice(appId, deviceId, input);
    return apiSuccess({ device });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId, deviceId } = await ctx.params;
    await requireKeyedApplication(request, appId);
    await removeDevice(appId, deviceId);
    return apiSuccess({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
