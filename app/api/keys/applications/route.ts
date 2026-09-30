import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { requirePlatformApiKey } from "@/lib/api-key";
import { createApplicationForKey } from "@/lib/api-key-application";
import { connectToDatabase } from "@/lib/mongodb";
import { searchAny } from "@/lib/search";
import { paginationSchema, keyCreateApplicationSchema } from "@/lib/validation";
import { ApplicationModel, toPublicApplication } from "@/models/Application";

/**
 * GET  /api/keys/applications  —  every application on the platform
 * POST /api/keys/applications  —  create one for a named owner
 *
 * PLATFORM-KEY ONLY. An application-scoped key is refused with
 * 403 API_KEY_SCOPE_DENIED: enumerating every tenant's applications is not
 * something a key issued for one application should ever be able to do.
 */

/** GET — list every application, newest first, with search + pagination. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requirePlatformApiKey(request);

    const url = new URL(request.url);
    const options = paginationSchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
    });
    const status = url.searchParams.get("status") ?? undefined;

    await connectToDatabase();

    const filter: Record<string, unknown> = {};
    // Escaped, so a term like ".*" is matched literally instead of sweeping the
    // whole collection.
    const matches = searchAny(options.search, ["name", "appId", "description"]);
    if (matches) filter.$or = matches;
    if (status === "active" || status === "suspended") filter.status = status;

    const skip = (options.page - 1) * options.limit;
    const [applications, total] = await Promise.all([
      ApplicationModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .lean(),
      ApplicationModel.countDocuments(filter),
    ]);

    return apiSuccess({
      applications: applications.map(toPublicApplication),
      total,
      page: options.page,
      limit: options.limit,
      totalPages: Math.max(1, Math.ceil(total / options.limit)),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST — create an application owned by `ownerId`.
 *
 * `ownerId` is mandatory, so this route can never create an application that
 * belongs to nobody or silently to the caller. That customer's plan cap is
 * still enforced by the shared service, so a platform key has no more licence
 * to exceed a limit than the owner does.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requirePlatformApiKey(request);

    const input = keyCreateApplicationSchema.parse(
      await readJsonBody<unknown>(request),
    );
    const application = await createApplicationForKey(input);
    return apiSuccess({ application }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
