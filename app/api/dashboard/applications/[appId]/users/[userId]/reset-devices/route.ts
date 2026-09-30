import { apiSuccess, handleApiError } from "@/lib/api-response";
import { resetUserDevices } from "@/lib/device";
import { requireAppUser } from "@/lib/authorization";

/**
 * POST /api/dashboard/applications/:appId/users/:userId/reset-devices
 * Frees all device seats and revokes the sessions bound to them.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/dashboard/applications/[appId]/users/[userId]/reset-devices">,
): Promise<Response> {
  try {
    const { appId, userId } = await ctx.params;
    await requireAppUser(appId, userId);
    const removed = await resetUserDevices(appId, userId);
    return apiSuccess({ devicesRemoved: removed });
  } catch (error) {
    return handleApiError(error);
  }
}
