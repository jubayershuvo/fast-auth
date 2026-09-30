import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { portalLogin } from "@/lib/portal";
import { portalLoginSchema, type PortalLoginInput } from "@/lib/validation";

/**
 * POST /api/portal/auth/login
 *
 * Sign an APPLICATION END USER in from a browser and open a portal session.
 *
 * Body: { "appId": "fa_…", "username": "player1", "password": "…" }
 *
 * `appId` is required and is the PUBLIC id, not the secret. It is needed
 * because an end-user username is only unique within an application: "player1"
 * in one app is a completely different account in another.
 *
 * The `appSecret` is deliberately NOT accepted. That is the customer's backend
 * second factor, and asking a person for it here would hand the application-wide
 * secret to every end user who signs in.
 *
 * Issues an httpOnly `fa_app_session` cookie. It does NOT register a device, so
 * visiting this page never consumes a licence seat.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const input: PortalLoginInput = portalLoginSchema.parse(
      await readJsonBody<unknown>(request),
    );
    const result = await portalLogin(input, request);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}