import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { requireKeyedApplication } from "@/lib/api-key";
import { banAppUser } from "@/lib/app-user";
import { banAppUserSchema } from "@/lib/validation";

/**
 * POST /api/keys/applications/:appId/users/:userId/ban
 *
 * A ban that left live sessions running would be trivially bypassed by a
 * client that simply never re-authenticates, so `revokeSessions` defaults to
 * true in the schema.
 */
type Context = RouteContext<"/api/keys/applications/[appId]/users/[userId]/ban">;

export async function POST(request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId, userId } = await ctx.params;
    await requireKeyedApplication(request, appId);
    const input = banAppUserSchema.parse(await readJsonBody<unknown>(request));
    const result = await banAppUser(appId, userId, input);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
