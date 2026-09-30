import { handleApiError, apiSuccess, readJsonBody } from "@/lib/api-response";
import { requestPasswordReset } from "@/lib/auth";
import { requestPasswordResetSchema, type RequestPasswordResetInput } from "@/lib/validation";

/**
 * POST /api/auth/forgot-password
 *
 * Step 1 of recovering a password you cannot sign in with. Accepts an email OR
 * a username, because the person at this screen is, by definition, someone who
 * cannot remember which they used.
 *
 * WORKS FOR BOTH CASES, which is the point of this endpoint: an account that
 * already has a password gets it REPLACED, and one that never had a password
 * gets its FIRST.
 *
 * The 6-digit code is the entire security of the flow: requesting it changes
 * nothing, and only someone who can read the mailbox can spend it.
 *
 * NOTE ON ENUMERATION: this used to return a byte-identical body for every
 * input, and that guarantee is deliberately GIVEN UP here — the response now
 * carries `maskedEmail` (empty when nothing was sent), because telling someone
 * where the code went is worth more to them than hiding it is worth to us. See
 * the long note on `requestPasswordReset` in `lib/auth.ts`, and the per-IP rate
 * limit that bounds the oracle.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const input: RequestPasswordResetInput = requestPasswordResetSchema.parse(
      await readJsonBody<unknown>(request),
    );
    const { maskedEmail } = await requestPasswordReset(input.identifier, request);
    return apiSuccess({
      sent: maskedEmail !== "",
      // A masked address, never the full one: enough to recognise the right
      // inbox, not enough to be a second copy of it in a public log.
      maskedEmail,
    });
  } catch (error) {
    return handleApiError(error);
  }
}