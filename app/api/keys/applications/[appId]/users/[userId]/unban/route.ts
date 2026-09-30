import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { requireKeyedApplication } from "@/lib/api-key";
import { unbanAppUser } from "@/lib/app-user";
import { unbanAppUserSchema } from "@/lib/validation";

/**
 * POST /api/keys/applications/:appId/users/:userId/unban
 *
 * Lifts a ban. Sessions issued while the ban was in force are only killed when
 * `revokeSessions` is true — defaulting to false, because a routine unban
 * should not sign the user out everywhere.
 */
type Context = RouteContext<"/api/keys/applications/[appId]/users/[userId]/unban">;

export async function POST(request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId, userId } = await ctx.params;
    await requireKeyedApplication(request, appId);
    const { revokeSessions } = unbanAppUserSchema.parse(
      await readJsonBody<unknown>(request),
    );
    const user = await unbanAppUser(appId, userId, revokeSessions);
    return apiSuccess({ user });
  } catch (error) {
    return handleApiError(error);
  }
}
