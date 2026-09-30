import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { getPortalProfile, updatePortalProfile } from "@/lib/portal";
import { requirePortalUser } from "@/lib/portal-auth";
import { portalUpdateProfileSchema, type PortalUpdateProfileInput } from "@/lib/validation";

/**
 * GET  /api/portal/me — the signed-in end user's own account.
 * PATCH /api/portal/me — update the one field they own.
 *
 * Authenticated by the httpOnly `fa_app_session` cookie. There is NO user id in
 * the path or the body: the target is always the session's own account, so this
 * endpoint cannot be pointed at somebody else's.
 *
 * PATCH accepts `name` and nothing else. Ban state, expiry, device limit and the
 * owner's private notes are the application's owner to control, and they are
 * absent from the accepted shape rather than merely unchecked.
 *
 * `notes` is reported as a constant `null` — it is the owner's remark about this
 * customer, which the account holder is not entitled to read.
 */
export async function GET(): Promise<Response> {
  try {
    const user = await requirePortalUser();
    return apiSuccess({ user: await getPortalProfile(user.id, user.applicationId) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const user = await requirePortalUser();
    const input: PortalUpdateProfileInput = portalUpdateProfileSchema.parse(
      await readJsonBody<unknown>(request),
    );
    const updated = await updatePortalProfile(user.id, user.applicationId, input);
    return apiSuccess({ user: updated });
  } catch (error) {
    return handleApiError(error);
  }
}