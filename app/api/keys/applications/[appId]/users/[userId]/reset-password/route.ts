import { apiSuccess, handleApiError } from "@/lib/api-response";
import { requireKeyedApplication } from "@/lib/api-key";
import { resetAppUserPassword } from "@/lib/app-user";

/**
 * POST /api/keys/applications/:appId/users/:userId/reset-password
 *
 * The plaintext is generated ON THE SERVER and returned EXACTLY ONCE — it is
 * hashed immediately and is unrecoverable. Treat the response as a one-time
 * secret, exactly like an app-secret reveal, and never log it.
 *
 * All of that user's live sessions are revoked in the same call: a reset that
 * leaves a stolen session running has not really reset anything.
 */
type Context =
  RouteContext<"/api/keys/applications/[appId]/users/[userId]/reset-password">;

export async function POST(request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId, userId } = await ctx.params;
    await requireKeyedApplication(request, appId);
    const result = await resetAppUserPassword(appId, userId);
    return apiSuccess({
      user: result.user,
      password: result.password,
      sessionsRevoked: result.sessionsRevoked,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
