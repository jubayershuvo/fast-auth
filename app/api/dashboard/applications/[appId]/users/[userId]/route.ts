import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { deleteAppUser, getAppUser, updateAppUser } from "@/lib/app-user";
import { requireAppUser } from "@/lib/authorization";
import { updateAppUserSchema } from "@/lib/validation";

/**
 * GET    /api/dashboard/applications/:appId/users/:userId
 * PATCH  /api/dashboard/applications/:appId/users/:userId
 * DELETE /api/dashboard/applications/:appId/users/:userId
 *
 * `requireAppUser` proves the caller owns the application AND that the user
 * belongs to it, in that order. Without the applicationId in the filter, a
 * valid userId from another tenant would be reachable — that is the exact
 * IDOR this helper exists to prevent.
 */

type Context = RouteContext<"/api/dashboard/applications/[appId]/users/[userId]">;

export async function GET(_request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId, userId } = await ctx.params;
    await requireAppUser(appId, userId);
    const user = await getAppUser(appId, userId);
    return apiSuccess({ user });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId, userId } = await ctx.params;
    await requireAppUser(appId, userId);
    const input = updateAppUserSchema.parse(await readJsonBody<unknown>(request));
    const user = await updateAppUser(appId, userId, input);
    return apiSuccess({ user });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId, userId } = await ctx.params;
    await requireAppUser(appId, userId);
    await deleteAppUser(appId, userId);
    return apiSuccess({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
