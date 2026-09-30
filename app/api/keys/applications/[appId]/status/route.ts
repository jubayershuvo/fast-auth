import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { requireKeyedApplication } from "@/lib/api-key";
import { setApplicationStatus } from "@/lib/application";
import { setApplicationStatusSchema } from "@/lib/validation";

/**
 * PATCH /api/keys/applications/:appId/status
 *
 * Start or stop the application. While stopped, every /api/v1 authentication
 * call is refused with 503 APP_SUSPENDED — new logins AND already-issued
 * sessions.
 *
 * Kept separate from the application PATCH for the same reason as the dashboard
 * equivalent: this cuts live traffic right now, so it earns its own endpoint and
 * its own confirmation instead of riding along with a rename.
 */
type Context = RouteContext<"/api/keys/applications/[appId]/status">;

export async function PATCH(request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId } = await ctx.params;
    const { application } = await requireKeyedApplication(request, appId);
    const { status } = setApplicationStatusSchema.parse(
      await readJsonBody<unknown>(request),
    );
    const updated = await setApplicationStatus(
      application.ownerId.toString(),
      appId,
      status,
    );
    return apiSuccess({ application: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
