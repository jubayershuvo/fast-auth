import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { banAppUser } from "@/lib/app-user";
import { requireAppUser } from "@/lib/authorization";
import { banAppUserSchema } from "@/lib/validation";

/** POST /api/dashboard/applications/:appId/users/:userId/ban */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/dashboard/applications/[appId]/users/[userId]/ban">,
): Promise<Response> {
  try {
    const { appId, userId } = await ctx.params;
    await requireAppUser(appId, userId);
    const input = banAppUserSchema.parse(await readJsonBody<unknown>(request));
    const result = await banAppUser(appId, userId, input);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
