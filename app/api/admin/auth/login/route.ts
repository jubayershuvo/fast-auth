import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { loginAdmin } from "@/lib/admin-auth";
import { dashboardLoginSchema, type DashboardLoginInput } from "@/lib/validation";

/**
 * POST /api/admin/auth/login
 *
 * Platform-operator sign-in. Intentionally mirrors the customer login shape
 * (identifier + password) but uses the dedicated admin cookie namespace and a
 * tighter rate limit.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const input: DashboardLoginInput = dashboardLoginSchema.parse(
      await readJsonBody<unknown>(request),
    );
    const admin = await loginAdmin(input.identifier, input.password, request);
    return apiSuccess(admin);
  } catch (error) {
    return handleApiError(error);
  }
}
