import "server-only";

import { Types } from "mongoose";

import { toObjectId } from "@/lib/authorization";
import { connectToDatabase } from "@/lib/mongodb";
import { AppUserModel } from "@/models/AppUser";
import { ApplicationModel } from "@/models/Application";
import { AuthLogModel, toPublicAuthLog, type PublicAuthLog } from "@/models/AuthLog";
import { DeviceModel } from "@/models/Device";
import { SessionModel } from "@/models/Session";

/**
 * Dashboard-wide statistics.
 *
 * Scoped to applications the caller owns, and joins across those application
 * ids so a customer only ever aggregates their own data.
 */
export async function getDashboardOverview(ownerId: string) {
  await connectToDatabase();

  const applications = await ApplicationModel.find({
    ownerId: new Types.ObjectId(ownerId),
  })
    .select("_id name appId")
    .lean();

  const appIds = applications.map((app) => app._id);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

  if (appIds.length === 0) {
    return {
      applicationCount: 0,
      totalUsers: 0,
      activeUsers: 0,
      bannedUsers: 0,
      expiredUsers: 0,
      totalDevices: 0,
      activeSessions: 0,
      loginsLast7Days: 0,
      failuresLast7Days: 0,
      recentEvents: [] as PublicAuthLog[],
      applications: [],
    };
  }

  const [
    totalUsers,
    bannedUsers,
    expiredUsers,
    activeUsers,
    totalDevices,
    activeSessions,
    loginsLast7Days,
    failuresLast7Days,
    recentEvents,
  ] = await Promise.all([
    AppUserModel.countDocuments({ applicationId: { $in: appIds } }),
    AppUserModel.countDocuments({ applicationId: { $in: appIds }, isBanned: true }),
    AppUserModel.countDocuments({
      applicationId: { $in: appIds },
      // Banned users are excluded so active + banned + expired === total.
      isBanned: false,
      expiresAt: { $ne: null, $lte: now },
    }),
    AppUserModel.countDocuments({
      applicationId: { $in: appIds },
      isBanned: false,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    }),
    DeviceModel.countDocuments({ applicationId: { $in: appIds } }),
    SessionModel.countDocuments({
      applicationId: { $in: appIds },
      revokedAt: null,
      expiresAt: { $gt: now },
    }),
    AuthLogModel.countDocuments({
      applicationId: { $in: appIds },
      action: "LOGIN_SUCCESS",
      createdAt: { $gte: weekAgo },
    }),
    AuthLogModel.countDocuments({
      applicationId: { $in: appIds },
      success: false,
      createdAt: { $gte: weekAgo },
    }),
    AuthLogModel.find({ applicationId: { $in: appIds } })
      .sort({ createdAt: -1 })
      .limit(12)
      .lean(),
  ]);

  return {
    applicationCount: applications.length,
    totalUsers,
    activeUsers,
    bannedUsers,
    expiredUsers,
    totalDevices,
    activeSessions,
    loginsLast7Days,
    failuresLast7Days,
    recentEvents: recentEvents.map(toPublicAuthLog),
    applications: applications.map((app) => ({
      id: app._id.toString(),
      name: app.name,
      appId: app.appId,
    })),
  };
}

/** Per-application user stats for the application detail page. */
export async function getApplicationStats(applicationId: string) {
  await connectToDatabase();
  const objectId = toObjectId(applicationId, "application id");
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

  const [totalUsers, bannedUsers, expiredUsers, activeUsers, totalDevices, activeSessions, loginsLast7Days, failuresLast7Days] =
    await Promise.all([
      AppUserModel.countDocuments({ applicationId: objectId }),
      AppUserModel.countDocuments({ applicationId: objectId, isBanned: true }),
      AppUserModel.countDocuments({
        applicationId: objectId,
        // Banned users are excluded so active + banned + expired === total.
        isBanned: false,
        expiresAt: { $ne: null, $lte: now },
      }),
      AppUserModel.countDocuments({
        applicationId: objectId,
        isBanned: false,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      }),
      DeviceModel.countDocuments({ applicationId: objectId }),
      SessionModel.countDocuments({
        applicationId: objectId,
        revokedAt: null,
        expiresAt: { $gt: now },
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

  return {
    totalUsers,
    bannedUsers,
    expiredUsers,
    activeUsers,
    totalDevices,
    activeSessions,
    loginsLast7Days,
    failuresLast7Days,
  };
}
