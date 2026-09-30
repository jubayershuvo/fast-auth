import { handleApiError, apiSuccess, readJsonBody } from "@/lib/api-response";
import { loginAccount } from "@/lib/auth";
import { dashboardLoginSchema, type DashboardLoginInput } from "@/lib/validation";

/**
 * POST /api/auth/login
 *
 * Signs a dashboard customer in and sets the httpOnly session cookie.
 * Rate limited per IP + identifier. Failures are deliberately generic
 * (no user enumeration).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const input: DashboardLoginInput = dashboardLoginSchema.parse(
      await readJsonBody<unknown>(request),
    );
    const user = await loginAccount(input.identifier, input.password, request);
    return apiSuccess(user);
  } catch (error) {
    return handleApiError(error);
  }
}
