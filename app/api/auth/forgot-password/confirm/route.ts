import { handleApiError, apiSuccess, readJsonBody } from "@/lib/api-response";
import { resetPasswordWithCode } from "@/lib/auth";
import { resetPasswordWithCodeSchema, type ResetPasswordWithCodeInput } from "@/lib/validation";

/**
 * POST /api/auth/forgot-password/confirm
 *
 * Step 3: the emailed code plus the new password. On success the account is
 * signed in on this device and a "password changed" notice is emailed.
 *
 * Replaces an existing password OR writes the first one — the two cases are the
 * same write, which is what makes this a single flow rather than two.
 *
 * Every OTHER session for the account is destroyed before the new one is
 * issued. That is the point of a reset: someone resetting a password they
 * believe is compromised needs whoever was using it locked out, and a reset
 * that left the old sessions alive would be no such thing.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const input: ResetPasswordWithCodeInput = resetPasswordWithCodeSchema.parse(
      await readJsonBody<unknown>(request),
    );
    const user = await resetPasswordWithCode(
      input.identifier,
      input.code,
      input.password,
      request,
    );
    return apiSuccess({ user });
  } catch (error) {
    return handleApiError(error);
  }
}