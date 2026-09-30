import { handleApiError, apiSuccess, readJsonBody } from "@/lib/api-response";
import { registerAccount } from "@/lib/auth";
import { registerSchema, type RegisterInput } from "@/lib/validation";

/**
 * POST /api/auth/register
 *
 * Creates a dashboard account and emails a 6-digit verification code. NO session
 * is issued: the account cannot be used until the code is entered, which is what
 * stops someone registering with an address they do not own.
 *
 * Returns 201 with the safe user shape plus `verificationRequired: true`, and
 * never the code itself — the only copy ever produced went to the inbox.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const input: RegisterInput = registerSchema.parse(
      await readJsonBody<unknown>(request),
    );
    const result = await registerAccount(input, request);
    return apiSuccess(result, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
