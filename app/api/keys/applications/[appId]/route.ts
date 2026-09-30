import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { requireKeyedApplication } from "@/lib/api-key";
import { deleteApplication, updateApplication } from "@/lib/application";
import { updateApplicationSchema } from "@/lib/validation";

/**
 * GET    /api/keys/applications/:appId  —  read one application
 * PATCH  /api/keys/applications/:appId  —  rename / re-describe
 * DELETE /api/keys/applications/:appId  —  cascade delete
 *
 * `requireKeyedApplication` does the whole authorisation job: it accepts BOTH
 * key scopes, and for an app-scoped key it only resolves the application when
 * the id matches the one the key was issued for. A platform key passes the same
 * check, so one route serves both realms with no `if (scope)` branching here.
 *
 * The owner is then read from the RESOLVED DOCUMENT, never from the request, so
 * the downstream owner-scoped services keep their single unbreakable invariant.
 */
type Context = RouteContext<"/api/keys/applications/[appId]">;

export async function GET(request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId } = await ctx.params;
    const { application } = await requireKeyedApplication(request, appId);
    return apiSuccess({
      application: {
        id: application._id.toString(),
        ownerId: application.ownerId.toString(),
        name: application.name,
        description: application.description,
        appId: application.appId,
        appSecretFingerprint: application.appSecretFingerprint,
        // Defaulted, not passed through: rows written before `status` existed
        // have no value, and reporting those as suspended would be a lie.
        status: application.status ?? "active",
        createdAt: application.createdAt.toISOString(),
        updatedAt: application.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId } = await ctx.params;
    const { application } = await requireKeyedApplication(request, appId);
    const input = updateApplicationSchema.parse(
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

export async function DELETE(request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId } = await ctx.params;
    const { application } = await requireKeyedApplication(request, appId);
    await deleteApplication(application.ownerId.toString(), appId);
    return apiSuccess({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
