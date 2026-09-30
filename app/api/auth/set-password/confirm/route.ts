import { handleApiError, apiSuccess, readJsonBody } from "@/lib/api-response";
import { setPasswordWithCode } from "@/lib/auth";
import { setPasswordWithCodeSchema, type SetPasswordWithCodeInput } from "@/lib/validation";

/**
 * POST /api/auth/set-password/confirm
 *
 * Step 2: the emailed code plus the password to store. On success the account
 * gains a normal password and the caller is signed in.
 *
 * The code is what proves the requester owns the mailbox — which is the whole
 * reason this flow is safe. Without it, anyone who learned an address could
 * "claim" an account that had no password.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const input: SetPasswordWithCodeInput = setPasswordWithCodeSchema.parse(
      await readJsonBody<unknown>(request),
    );
    const user = await setPasswordWithCode(
      input.email,
      input.code,
      input.password,
      request,
    );
    return apiSuccess({ user });
  } catch (error) {
    return handleApiError(error);
  }
}
