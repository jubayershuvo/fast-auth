import { handleApiError, apiSuccess, readJsonBody } from "@/lib/api-response";
import { verifyAccountEmail } from "@/lib/auth";
import { verifyEmailSchema, type VerifyEmailInput } from "@/lib/validation";

/**
 * POST /api/auth/verify-email
 *
 * Confirms the emailed 6-digit code and signs the account in.
 *
 * Verifying and signing in are ONE call on purpose. Splitting them would let an
 * attacker who intercepted the code verify the account and then sit waiting for
 * the real owner to type a password.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const input: VerifyEmailInput = verifyEmailSchema.parse(
      await readJsonBody<unknown>(request),
    );
    const user = await verifyAccountEmail(input.email, input.code, request);
    return apiSuccess({ user });
  } catch (error) {
    return handleApiError(error);
  }
}
