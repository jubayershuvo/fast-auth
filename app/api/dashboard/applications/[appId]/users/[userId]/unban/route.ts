import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { unbanAppUser } from "@/lib/app-user";
import { requireAppUser } from "@/lib/authorization";
import { unbanAppUserSchema } from "@/lib/validation";


/**
 * POST .../unban
 * The body is optional — a bare request lifts the ban without revoking
 * sessions. Pass { "revokeSessions": true } to also kill live sessions.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/dashboard/applications/[appId]/users/[userId]/unban">,
): Promise<Response> {
  try {
    const { appId, userId } = await ctx.params;
    await requireAppUser(appId, userId);

    let input = { revokeSessions: false };
    try {
      input = unbanAppUserSchema.parse(await readJsonBody<unknown>(request, 2048));
    } catch {
      // Empty body is valid here.
    }

    const user = await unbanAppUser(appId, userId, input.revokeSessions);
    return apiSuccess({ user });
  } catch (error) {
    return handleApiError(error);
  }
}
