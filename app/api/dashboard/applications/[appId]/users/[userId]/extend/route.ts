import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { extendAppUser } from "@/lib/app-user";
import { requireAppUser } from "@/lib/authorization";
import { extendAppUserSchema } from "@/lib/validation";

/**
 * POST /api/dashboard/applications/:appId/users/:userId/extend
 *
 * Body: { "days": 30, "from": "now" | "previous" }
 *
 * "previous" continues from the account's current expiry, which is how an
 * owner restores an already-expired licence for its full remaining term.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/dashboard/applications/[appId]/users/[userId]/extend">,
): Promise<Response> {
  try {
    const { appId, userId } = await ctx.params;
    await requireAppUser(appId, userId);
    const input = extendAppUserSchema.parse(await readJsonBody<unknown>(request));
    const user = await extendAppUser(appId, userId, input);
    return apiSuccess({ user });
  } catch (error) {
    return handleApiError(error);
  }
}
