import { apiSuccess, handleApiError } from "@/lib/api-response";
import { revokeAllAppSessions } from "@/lib/app-session";
import { requireAppUser } from "@/lib/authorization";

/**
 * POST /api/dashboard/applications/:appId/users/:userId/revoke-sessions
 * Kills every live session for this user (signs them out everywhere).
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/dashboard/applications/[appId]/users/[userId]/revoke-sessions">,
): Promise<Response> {
  try {
    const { appId, userId } = await ctx.params;
    await requireAppUser(appId, userId);
    const revoked = await revokeAllAppSessions(appId, userId);
    return apiSuccess({ revoked });
  } catch (error) {
    return handleApiError(error);
  }
}
