import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { loginToApplication, requireAppIdHeader } from "@/lib/v1-auth";
import { v1LoginSchema, type V1LoginInput } from "@/lib/validation";

/**
 * POST /api/v1/auth/login  —  public customer-facing endpoint.
 *
 * Headers:
 *   X-App-Id: fa_...        the public application id (required)
 *
 * Body:
 *   { "username": "player123", "password": "Secret123", "deviceId": "device-abc" }
 *
 * Success (200):
 *   { "success": true, "data": { "sessionToken": "...", "expiresAt": "...",
 *     "user": { "username", "deviceId", "devicesUsed", "maxDevices",
 *               "isNewDevice" } } }
 *
 * Failure (4xx):
 *   { "success": false, "error": "ACCOUNT_BANNED", "message": "..." }
 *
 * Use the returned `sessionToken` as `Authorization: Bearer <token>`.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    // The application id comes from the header, never the body, so it cannot
    // disagree with the credentials in the same request.
    const appId = requireAppIdHeader(request);
    const input: V1LoginInput = v1LoginSchema.parse(await readJsonBody<unknown>(request));
    const result = await loginToApplication({ ...input, appId }, request);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
