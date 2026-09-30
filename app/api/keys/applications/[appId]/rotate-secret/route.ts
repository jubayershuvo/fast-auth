import { apiSuccess, handleApiError } from "@/lib/api-response";
import { requireKeyedApplication } from "@/lib/api-key";
import { rotateApplicationSecret } from "@/lib/application";

/**
 * POST /api/keys/applications/:appId/rotate-secret
 *
 * Issues a new app secret and returns it ONCE. Any client still sending the
 * previous secret stops working immediately, so this is a breaking change for
 * live deployments — rotate deliberately, not on a schedule.
 */
type Context = RouteContext<"/api/keys/applications/[appId]/rotate-secret">;

export async function POST(request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId } = await ctx.params;
    const { application } = await requireKeyedApplication(request, appId);
    const result = await rotateApplicationSecret(
      application.ownerId.toString(),
      appId,
    );
    return apiSuccess({ application: result });
  } catch (error) {
    return handleApiError(error);
  }
}
