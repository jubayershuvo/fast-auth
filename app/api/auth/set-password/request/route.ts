import { handleApiError, apiSuccess, readJsonBody } from "@/lib/api-response";
import { requestPasswordSetup } from "@/lib/auth";
import { requestPasswordSetupSchema, type RequestPasswordSetupInput } from "@/lib/validation";

/**
 * POST /api/auth/set-password/request
 *
 * Step 1 of claiming a password on an account that has none — a platform-created
 * account, or an OAuth-only one.
 *
 * Sends a 6-digit code to the address on file. The response is identical for an
 * unknown address, an address that already has a password, and a real one, so
 * this leaks nothing about who has an account here.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const input: RequestPasswordSetupInput = requestPasswordSetupSchema.parse(
      await readJsonBody<unknown>(request),
    );
    await requestPasswordSetup(input.email);
    return apiSuccess({
      sent: true,
      message: "If that account has no password, a 6-digit code is on its way.",
    });
  } catch (error) {
    return handleApiError(error);
  }
}
