import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { requireKeyedApplication } from "@/lib/api-key";
import { deleteAppUser, getAppUser, updateAppUser } from "@/lib/app-user";
import { updateAppUserSchema } from "@/lib/validation";

/**
 * GET    /api/keys/applications/:appId/users/:userId
 * PATCH  /api/keys/applications/:appId/users/:userId
 * DELETE /api/keys/applications/:appId/users/:userId
 *
 * Both ids are resolved server-side: the application against the KEY's scope,
 * the user against that application. A userId from another tenant simply does
 * not resolve, so there is no reachable path across applications.
 */
type Context = RouteContext<"/api/keys/applications/[appId]/users/[userId]">;

export async function GET(request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId, userId } = await ctx.params;
    await requireKeyedApplication(request, appId);
    const user = await getAppUser(appId, userId);
    return apiSuccess({ user });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId, userId } = await ctx.params;
    await requireKeyedApplication(request, appId);
    const input = updateAppUserSchema.parse(await readJsonBody<unknown>(request));
    const user = await updateAppUser(appId, userId, input);
    return apiSuccess({ user });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId, userId } = await ctx.params;
    await requireKeyedApplication(request, appId);
    await deleteAppUser(appId, userId);
    return apiSuccess({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
