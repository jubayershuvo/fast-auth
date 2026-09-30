import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { deleteApplication, updateApplication } from "@/lib/application";
import { requireApplicationOwner } from "@/lib/authorization";
import { updateApplicationSchema, type UpdateApplicationInput } from "@/lib/validation";

/**
 * Route handlers for a single application.
 *
 * Every handler begins with `requireApplicationOwner(appId)`, which resolves
 * the owner from the session cookie and 404s if the application is missing OR
 * belongs to somebody else. Only then is the supplied applicationId used to
 * scope the write — so a valid id belonging to another customer is
 * indistinguishable from one that does not exist (this is the IDOR guard).
 *
 * `params` is a Promise in Next.js 16 and must be awaited.
 */

type Context = RouteContext<"/api/dashboard/applications/[appId]">;

export async function GET(_request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId } = await ctx.params;
    const application = await requireApplicationOwner(appId);
    return apiSuccess({
      application: {
        id: application._id.toString(),
        name: application.name,
        appId: application.appId,
        createdAt: application.createdAt.toISOString(),
        updatedAt: application.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/** PATCH — rename or update the description. */
export async function PATCH(request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId } = await ctx.params;
    const application = await requireApplicationOwner(appId);
    const input: UpdateApplicationInput = updateApplicationSchema.parse(
      await readJsonBody<unknown>(request),
    );
    const updated = await updateApplication(
      application.ownerId.toString(),
      appId,
      input,
    );
    return apiSuccess({ application: updated });
  } catch (error) {
    return handleApiError(error);
  }
}

/** DELETE — cascades to users, devices, sessions and logs. */
export async function DELETE(_request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId } = await ctx.params;
    const application = await requireApplicationOwner(appId);
    await deleteApplication(application.ownerId.toString(), appId);
    return apiSuccess({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
