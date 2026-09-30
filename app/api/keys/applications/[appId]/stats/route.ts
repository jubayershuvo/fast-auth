import { NextResponse } from "next/server";

import { apiSuccess, handleApiError } from "@/lib/api-response";
import { requireKeyedApplication } from "@/lib/api-key";
import { getAppUserStats } from "@/lib/app-user";
import { connectToDatabase } from "@/lib/mongodb";
import { toObjectId } from "@/lib/authorization";
import { SessionModel } from "@/models/Session";
import { DeviceModel } from "@/models/Device";
import { AuthLogModel } from "@/models/AuthLog";

/**
 * GET /api/keys/applications/:appId/stats
 *
 * The counters a monitoring job polls: users by state, devices, live sessions,
 * and the 7-day success/failure split.
 *
 * Built from the SAME queries the dashboard stats route uses, rather than
 * calling it, so the numbers an integration reads and the numbers a human sees
 * are computed identically. (The dashboard route is a route handler, so it
 * cannot be reused as a service.)
 */
type Context = RouteContext<"/api/keys/applications/[appId]/stats">;

export async function GET(request: Request, ctx: Context): Promise<NextResponse> {
  try {
    const { appId } = await ctx.params;
    await requireKeyedApplication(request, appId);

    const objectId = toObjectId(appId, "application id");
    await connectToDatabase();

    const weekAgo = new Date(Date.now() - 7 * 86_400_000);

    const [userStats, devices, activeSessions, loginsLast7Days, failuresLast7Days] =
      await Promise.all([
        getAppUserStats(appId),
        DeviceModel.countDocuments({ applicationId: objectId }),
        SessionModel.countDocuments({
          applicationId: objectId,
          revokedAt: null,
          expiresAt: { $gt: new Date() },
        }),
        AuthLogModel.countDocuments({
          applicationId: objectId,
          action: "LOGIN_SUCCESS",
          createdAt: { $gte: weekAgo },
        }),
        AuthLogModel.countDocuments({
          applicationId: objectId,
          success: false,
          createdAt: { $gte: weekAgo },
        }),
      ]);

    return apiSuccess({
      ...userStats,
      devices,
      activeSessions,
      loginsLast7Days,
      failuresLast7Days,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
