import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { createAppUser, listAppUsers } from "@/lib/app-user";
import { requireApplicationOwner } from "@/lib/authorization";
import { paginationSchema, type PaginationInput } from "@/lib/validation";

/**
 * GET /api/dashboard/applications/:appId/users
 * POST /api/dashboard/applications/:appId/users
 *
 * `requireApplicationOwner` runs first in both handlers, so the applicationId
 * in the URL is only ever used to scope a query the caller already owns.
 */

type Context = RouteContext<"/api/dashboard/applications/[appId]/users">;

export async function GET(request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId } = await ctx.params;
    await requireApplicationOwner(appId);

    const url = new URL(request.url);
    const options: PaginationInput & { status?: string } = paginationSchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
    });
    const status = url.searchParams.get("status") ?? undefined;
    if (status && !["active", "banned", "expired"].includes(status)) {
      return apiSuccess({ users: [], total: 0, page: 1, limit: options.limit, totalPages: 1 });
    }

    const result = await listAppUsers(appId, { ...options, status });
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, ctx: Context): Promise<Response> {
  try {
    const { appId } = await ctx.params;
    await requireApplicationOwner(appId);

    const input = await readJsonBody<Parameters<typeof createAppUser>[1]>(request);
    // Validate with the same schema the service expects.
    const { createAppUserSchema } = await import("@/lib/validation");
    const parsed = createAppUserSchema.parse(input);

    const user = await createAppUser(appId, parsed);
    return apiSuccess(user, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
