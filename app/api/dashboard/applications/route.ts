import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { createApplication, listApplications } from "@/lib/application";
import { requireDashboardUser } from "@/lib/authorization";
import { createApplicationSchema, type CreateApplicationInput } from "@/lib/validation";

/**
 * GET /api/dashboard/applications
 *
 * Lists only the signed-in customer's applications — the ownerId comes from
 * the session, never from the request.
 */
export async function GET(): Promise<Response> {
  try {
    const user = await requireDashboardUser();
    const applications = await listApplications(user.id);
    return apiSuccess({ applications });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/dashboard/applications
 *
 * Creates an application and returns the app secret ONCE. The response is
 * never cacheable, so an intermediary cannot retain the secret.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireDashboardUser();
    const input: CreateApplicationInput = createApplicationSchema.parse(
      await readJsonBody<unknown>(request),
    );
    const application = await createApplication(user.id, input);
    return apiSuccess(application, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
