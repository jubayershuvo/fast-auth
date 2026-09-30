import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiSuccess, handleApiError } from "@/lib/api-response";
import { requireApplicationOwner } from "@/lib/authorization";
import { paginationSchema, type PaginationInput } from "@/lib/validation";
import { connectToDatabase } from "@/lib/mongodb";
import { toObjectId } from "@/lib/authorization";
import { AuthLogModel, buildAuthLogFilter, toPublicAuthLog } from "@/models/AuthLog";

/**
 * GET /api/dashboard/applications/:appId/logs
 *
 * Returns the audit trail newest-first. Records identifiers and outcomes
 * only — never credentials.
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/dashboard/applications/[appId]/logs">,
): Promise<NextResponse> {
  try {
    const { appId } = await ctx.params;
    await requireApplicationOwner(appId);

    const url = new URL(request.url);
    const options: PaginationInput = paginationSchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    const action = url.searchParams.get("action");
    const search = url.searchParams.get("search") ?? undefined;

    await connectToDatabase();
    const filter = buildAuthLogFilter(toObjectId(appId, "application id"), {
      action: action ?? undefined,
      search,
    });

    const skip = (options.page - 1) * options.limit;
    const [logs, total] = await Promise.all([
      AuthLogModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .lean(),
      AuthLogModel.countDocuments(filter),
    ]);

    return apiSuccess({
      logs: logs.map(toPublicAuthLog),
      total,
      page: options.page,
      limit: options.limit,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
