import { apiSuccess, handleApiError } from "@/lib/api-response";
import { requireKeyedApplication } from "@/lib/api-key";
import { resetUserDevices } from "@/lib/device";

/**
 * POST /api/keys/applications/:appId/users/:userId/reset-devices
 *
 * Frees every device seat and revokes the sessions bound to them. Revoking
 * alongside matters: otherwise the user keeps unlimited concurrent access
 * through devices that are no longer supposed to exist.
 */
type Context =
  RouteContext<"/api/keys/applications/[appId]/users/[userId]/reset-devices">;

export async function POST(request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId, userId } = await ctx.params;
    await requireKeyedApplication(request, appId);
    const devicesRemoved = await resetUserDevices(appId, userId);
    return apiSuccess({ devicesRemoved });
  } catch (error) {
    return handleApiError(error);
  }
}
