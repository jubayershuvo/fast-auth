import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { requireKeyedApplication } from "@/lib/api-key";
import { createAppUser, listAppUsers } from "@/lib/app-user";
import { createAppUserSchema, paginationSchema } from "@/lib/validation";

/**
 * GET  /api/keys/applications/:appId/users  —  list end users
 * POST /api/keys/applications/:appId/users  —  create one
 *
 * This is the "api key + appId" surface the whole design exists for: a
 * customer's backend provisioning licences without a cookie.
 *
 * The service is NOT owner-scoped (it scopes purely by `applicationId`), which
 * is safe here precisely because `requireKeyedApplication` has already proved
 * this key may act on that application. The two checks are complementary: one
 * answers "may you?", the other "which rows?".
 */
type Context = RouteContext<"/api/keys/applications/[appId]/users">;

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
    const status = url.searchParams.get("status") ?? undefined;

    const result = await listAppUsers(appId, {
      ...options,
      // An unknown status yields an empty page rather than an error, mirroring
      // the dashboard: a filter chip the client invented should not 400 a
      // listing call.
      status: status && ["active", "banned", "expired"].includes(status) ? status : undefined,
    });
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest, ctx: Context): Promise<NextResponse> {
  try {
    const { appId } = await ctx.params;
    await requireKeyedApplication(request, appId);
    const input = createAppUserSchema.parse(await readJsonBody<unknown>(request));
    const user = await createAppUser(appId, input);
    return apiSuccess({ user }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
