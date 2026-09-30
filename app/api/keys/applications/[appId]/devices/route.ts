import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiSuccess, handleApiError } from "@/lib/api-response";
import { requireKeyedApplication } from "@/lib/api-key";
import { listDevices } from "@/lib/device";
import { paginationSchema } from "@/lib/validation";

/**
 * GET /api/keys/applications/:appId/devices
 *
 * Lists every registered device in the application, newest activity first.
 * Filter by `userId` to see one licence's seats; `search` matches the fields an
 * operator recognises a machine by (device id, name, platform, last IP).
 */
type Context = RouteContext<"/api/keys/applications/[appId]/devices">;

export async function GET(request: NextRequest, ctx: Context): Promise<NextResponse> {
  try {
    const { appId } = await ctx.params;
    await requireKeyedApplication(request, appId);

    const url = new URL(request.url);
    const options = paginationSchema.parse({
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
