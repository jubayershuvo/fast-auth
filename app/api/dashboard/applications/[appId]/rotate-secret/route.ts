import { apiSuccess, handleApiError } from "@/lib/api-response";
import { rotateApplicationSecret } from "@/lib/application";
import { requireApplicationOwner } from "@/lib/authorization";

/**
 * POST /api/dashboard/applications/:appId/rotate-secret
 *
 * Issues a new app secret and returns it ONCE. Clients still using the old
 * secret immediately stop working — surfaced in the UI as a warning.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/dashboard/applications/[appId]/rotate-secret">,
): Promise<Response> {
  try {
    const { appId } = await ctx.params;
    const application = await requireApplicationOwner(appId);
    const result = await rotateApplicationSecret(
      application.ownerId.toString(),
      appId,
    );
    return apiSuccess({ application: result });
  } catch (error) {
    return handleApiError(error);
  }
}
