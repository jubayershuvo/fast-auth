import { handleApiError, apiSuccess, readJsonBody } from "@/lib/api-response";
import { resendVerificationCode } from "@/lib/auth";
import { resendVerificationSchema, type ResendVerificationInput } from "@/lib/validation";

/**
 * POST /api/auth/resend-verification
 *
 * Re-sends the registration code.
 *
 * The response is IDENTICAL whether or not the address has an account, so this
 * cannot be used to discover who is registered. Rate limited per address.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const input: ResendVerificationInput = resendVerificationSchema.parse(
      await readJsonBody<unknown>(request),
    );
    await resendVerificationCode(input.email);
    return apiSuccess({
      sent: true,
      message: "If that address is awaiting verification, a new code is on its way.",
    });
  } catch (error) {
    return handleApiError(error);
  }
}
