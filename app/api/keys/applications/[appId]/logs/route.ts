import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiSuccess, handleApiError } from "@/lib/api-response";
import { requireKeyedApplication } from "@/lib/api-key";
import { connectToDatabase } from "@/lib/mongodb";
import { toObjectId } from "@/lib/authorization";
import { paginationSchema } from "@/lib/validation";
import { AuthLogModel, buildAuthLogFilter, toPublicAuthLog } from "@/models/AuthLog";

/**
 * GET /api/keys/applications/:appId/logs
 *
 * The audit trail, newest first. Records identifiers and outcomes only — never
 * credentials — so it is safe to ship to a support tool, but it does expose who
 * signed in from where, which is exactly what it is for.
 */
type Context = RouteContext<"/api/keys/applications/[appId]/logs">;

export async function GET(request: NextRequest, ctx: Context): Promise<NextResponse> {
  try {
    const { appId } = await ctx.params;
    await requireKeyedApplication(request, appId);

    const url = new URL(request.url);
    const options = paginationSchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    const action = url.searchParams.get("action") ?? undefined;
    const search = url.searchParams.get("search") ?? undefined;

    await connectToDatabase();
    const filter = buildAuthLogFilter(toObjectId(appId, "application id"), {
      action,
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
