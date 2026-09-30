import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiSuccess, handleApiError } from "@/lib/api-response";
import { requireKeyedApplication } from "@/lib/api-key";
import { listAppSessions } from "@/lib/app-session";
import { paginationSchema } from "@/lib/validation";

/**
 * GET /api/keys/applications/:appId/sessions
 *
 * Live session rows for the application. Read-only: revocation is a per-user
 * action (`.../users/{userId}/revoke-sessions`) or a per-device one, so there
 * is deliberately no "delete session by id" route to misuse.
 */
type Context = RouteContext<"/api/keys/applications/[appId]/sessions">;

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

    const result = await listAppSessions(appId, { ...options, userId });
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
