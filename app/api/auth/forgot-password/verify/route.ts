import { handleApiError, apiSuccess, readJsonBody } from "@/lib/api-response";
import { verifyPasswordResetCode } from "@/lib/auth";
import {
  verifyPasswordResetCodeSchema,
  type VerifyPasswordResetCodeInput,
} from "@/lib/validation";

/**
 * POST /api/auth/forgot-password/verify
 *
 * Step 2: is the code right?
 *
 * The screen asks for the code on its own BEFORE showing the password fields, so
 * somebody who cannot find the email is not shown a password form they will
 * fail. This exists purely as that gate.
 *
 * The code is NOT consumed. `consumeVerificationCode` is still called, so every
 * check it makes — expiry, the five-attempt budget, destroying the code once
 * that budget is gone — applies here in full. Guessing costs exactly as much
 * here as it would at the real step; only the final `confirm` spends it.
 *
 * Rate limited per IP for the same reason sign-in is: without that, a
 * wrong-code-only attacker gets a few more free attempts per code.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const input: VerifyPasswordResetCodeInput = verifyPasswordResetCodeSchema.parse(
      await readJsonBody<unknown>(request),
    );
    const { maskedEmail } = await verifyPasswordResetCode(
      input.identifier,
      input.code,
    );
    return apiSuccess({ valid: true, maskedEmail });
  } catch (error) {
    return handleApiError(error);
  }
}