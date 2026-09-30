import { NextResponse } from "next/server";

import { apiSuccess, handleApiError } from "@/lib/api-response";
import { requireApplicationOwner } from "@/lib/authorization";
import { getAppUserStats } from "@/lib/app-user";
import { connectToDatabase } from "@/lib/mongodb";
import { toObjectId } from "@/lib/authorization";
import { SessionModel } from "@/models/Session";
import { DeviceModel } from "@/models/Device";
import { AuthLogModel } from "@/models/AuthLog";

/**
 * GET /api/dashboard/applications/:appId/stats
 * Counts backing the overview cards: users, devices, sessions, and the
 * recent success/failure split for the last 7 days.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/dashboard/applications/[appId]/stats">,
): Promise<NextResponse> {
  try {
    const { appId } = await ctx.params;
    await requireApplicationOwner(appId);

    const objectId = toObjectId(appId, "application id");
    await connectToDatabase();

    const weekAgo = new Date(Date.now() - 7 * 86_400_000);

    const [userStats, devices, activeSessions, recentLogins, recentFailures] =
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
      loginsLast7Days: recentLogins,
      failuresLast7Days: recentFailures,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
