import { apiSuccess, handleApiError } from "@/lib/api-response";
import { requireKeyedApplication } from "@/lib/api-key";
import { revokeAllAppSessions } from "@/lib/app-session";

/**
 * POST /api/keys/applications/:appId/users/:userId/revoke-sessions
 *
 * Kills every live session for this user — signs them out on every device.
 */
type Context =
  RouteContext<"/api/keys/applications/[appId]/users/[userId]/revoke-sessions">;

export async function POST(request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId, userId } = await ctx.params;
    await requireKeyedApplication(request, appId);
    const revoked = await revokeAllAppSessions(appId, userId, "REVOKED_BY_API");
    return apiSuccess({ revoked });
  } catch (error) {
    return handleApiError(error);
  }
}
