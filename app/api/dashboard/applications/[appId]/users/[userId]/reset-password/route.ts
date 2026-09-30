import { apiSuccess, handleApiError } from "@/lib/api-response";
import { resetAppUserPassword } from "@/lib/app-user";
import { requireApplicationOwner } from "@/lib/authorization";

/**
 * POST /api/dashboard/applications/:appId/users/:userId/reset-password
 *
 * Generates a new password on the server and returns the plaintext EXACTLY ONCE
 * — it is hashed immediately and is not recoverable afterwards. The response
 * must be treated as a one-time secret by the client, the same way the app
 * secret reveal is.
 *
 * All live sessions are revoked in the same call: a reset that leaves a
 * stolen session running has not really reset anything.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/dashboard/applications/[appId]/users/[userId]/reset-password">,
): Promise<Response> {
  try {
    const { appId, userId } = await ctx.params;
    // Ownership before the write, so a valid id from another tenant 404s.
    await requireApplicationOwner(appId);
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
