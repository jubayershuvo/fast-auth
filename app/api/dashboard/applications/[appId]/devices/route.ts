import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiSuccess, handleApiError } from "@/lib/api-response";
import { listDevices } from "@/lib/device";
import { requireApplicationOwner } from "@/lib/authorization";
import { paginationSchema, type PaginationInput } from "@/lib/validation";

/** GET /api/dashboard/applications/:appId/devices */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/dashboard/applications/[appId]/devices">,
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

    const result = await listDevices(appId, { ...options, userId });
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
