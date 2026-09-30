import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { requireApplicationOwner } from "@/lib/authorization";
import { setApplicationStatus } from "@/lib/application";
import { setApplicationStatusSchema } from "@/lib/validation";

/**
 * PATCH /api/dashboard/applications/:appId/status
 *
 * Start or Stop the application. While stopped, every /api/v1 authentication
 * call is refused with 503 APP_SUSPENDED — new logins AND already-issued
 * sessions — until it is started again.
 *
 * Deliberately NOT a field on the application PATCH: this changes who can sign
 * in right now, so it gets its own endpoint, its own confirmation and its own
 * audit entry instead of riding along with a rename.
 */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/dashboard/applications/[appId]/status">,
): Promise<Response> {
  try {
    const { appId } = await ctx.params;
    const { status } = setApplicationStatusSchema.parse(
      await readJsonBody<unknown>(request),
    );
    // Ownership before the write, so a valid id belonging to another customer
    // is indistinguishable from one that does not exist.
    const application = await requireApplicationOwner(appId);
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
