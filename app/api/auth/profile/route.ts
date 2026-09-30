import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { updateProfile } from "@/lib/auth";
import { requireSessionUser } from "@/lib/session";
import { updateProfileSchema } from "@/lib/validation";

/**
 * PATCH /api/auth/profile
 *
 * Updates the signed-in customer's own display name.
 *
 * Only `name` is accepted. Email and username are identity fields with their own
 * uniqueness rules and recovery flows, and are intentionally not editable from
 * here.
 *
 * There is no userId in the body: the target is always the session's own user,
 * so this endpoint cannot be pointed at another account.
 */
export async function PATCH(request: Request): Promise<Response> {
  try {
    const session = await requireSessionUser();
    const { name } = updateProfileSchema.parse(await readJsonBody<unknown>(request));
    const user = await updateProfile(session.id, name);
    return apiSuccess({ user });
  } catch (error) {
    return handleApiError(error);
  }
}
