import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiSuccess, handleApiError } from "@/lib/api-response";
import { listAppSessions } from "@/lib/app-session";
import { requireApplicationOwner } from "@/lib/authorization";
import { paginationSchema, type PaginationInput } from "@/lib/validation";

/** GET /api/dashboard/applications/:appId/sessions */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/dashboard/applications/[appId]/sessions">,
): Promise<NextResponse> {
  try {
    const { appId } = await ctx.params;
    await requireApplicationOwner(appId);

    const url = new URL(request.url);
    const options: PaginationInput & { userId?: string; search?: string } = paginationSchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
    });
    const userId = url.searchParams.get("userId") ?? undefined;

    const result = await listAppSessions(appId, { ...options, userId });
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
