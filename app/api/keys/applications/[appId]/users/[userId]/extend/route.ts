import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { requireKeyedApplication } from "@/lib/api-key";
import { extendAppUser } from "@/lib/app-user";
import { extendAppUserSchema } from "@/lib/validation";

/**
 * POST /api/keys/applications/:appId/users/:userId/extend
 *
 * Body: { "days": 30, "from": "now" | "previous" }
 *
 * "previous" continues from the account's current expiry, which is how an
 * already-expired licence is restored for its full remaining term rather than
 * only for the days that have not yet elapsed.
 */
type Context = RouteContext<"/api/keys/applications/[appId]/users/[userId]/extend">;

export async function POST(request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId, userId } = await ctx.params;
    await requireKeyedApplication(request, appId);
    const input = extendAppUserSchema.parse(await readJsonBody<unknown>(request));
    const user = await extendAppUser(appId, userId, input);
    return apiSuccess({ user });
  } catch (error) {
    return handleApiError(error);
  }
}
