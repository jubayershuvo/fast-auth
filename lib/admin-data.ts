import "server-only";

import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/mongodb";
import type { PaginationInput } from "@/lib/validation";
import { getPlan, listPlans } from "@/lib/plan-catalog";
import { AppUserModel } from "@/models/AppUser";
import { ApplicationModel } from "@/models/Application";
import { AuthLogModel, toPublicAuthLog, type AuthActionValue } from "@/models/AuthLog";
import { DeviceModel } from "@/models/Device";
import { SessionModel } from "@/models/Session";
import { UserModel } from "@/models/User";

/**
 * Platform-wide (cross-tenant) read layer for the admin panel.
 *
 * ============================================================================
 *  READ THIS BEFORE ADDING A QUERY HERE
 * ============================================================================
 * Every function in this file is the ONE deliberate exception to the
 * "always scope by ownerId" rule that governs the customer-facing services in
 * lib/application.ts and lib/app-user.ts. It does not scope, because the
 * platform operator legitimately needs to see all tenants.
 *
 * Consequences you must accept when adding code here:
 *   - The response crosses tenant boundaries. Never expose these shapes to a
 *     customer-facing route.
 *   - Every function below MUST be called only after `requireAdminIdentity()`
 *     or `requireAdminPage()` has succeeded.
 *   - `appSecretHash` and `passwordHash` are never selected here.
 *
 * If a function in this file is ever reachable from a customer session, that
 * is a full-platform data breach. Keep the dependency direction one-way:
 * customer services must never import this module.
 */

const DAY_MS = 86_400_000;

/** Platform-wide totals for the admin overview. */
export async function getPlatformStats() {
  await connectToDatabase();
  const now = new Date();
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);

  const [
    customers,
    admins,
    applications,
    totalAppUsers,
    bannedAppUsers,
    expiredAppUsers,
    activeAppUsers,
    devices,
    activeSessions,
    loginsToday,
    loginsWeek,
    failuresWeek,
  ] = await Promise.all([
    UserModel.countDocuments({}),
    // Imported lazily to keep the customer `User` import graph untouched.
    (await import("@/models/AdminUser")).AdminUserModel.countDocuments({}),
    ApplicationModel.countDocuments({}),
    AppUserModel.countDocuments({}),
    AppUserModel.countDocuments({ isBanned: true }),
    AppUserModel.countDocuments({ expiresAt: { $ne: null, $lte: now } }),
    AppUserModel.countDocuments({
      isBanned: false,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    }),
    DeviceModel.countDocuments({}),
    SessionModel.countDocuments({ revokedAt: null, expiresAt: { $gt: now } }),
    AuthLogModel.countDocuments({ action: "LOGIN_SUCCESS", createdAt: { $gte: dayAgo } }),
    AuthLogModel.countDocuments({ action: "LOGIN_SUCCESS", createdAt: { $gte: weekAgo } }),
    AuthLogModel.countDocuments({ success: false, createdAt: { $gte: weekAgo } }),
  ]);

  return {
    customers,
    admins,
    applications,
    totalAppUsers,
    bannedAppUsers,
    expiredAppUsers,
    activeAppUsers,
    devices,
    activeSessions,
    loginsToday,
    loginsWeek,
    failuresWeek,
  };
}

/** How many customers sit on each subscription tier. */
export async function getPlanDistribution(): Promise<Record<string, number>> {
  await connectToDatabase();
  const rows = await UserModel.aggregate<{ _id: string; count: number }>([
    { $group: { _id: { $ifNull: ["$plan", "free"] }, count: { $sum: 1 } } },
  ]);

  // Start from zero for every tier so the chart never has missing buckets.
  const distribution: Record<string, number> = {};
  for (const plan of listPlans()) distribution[plan.id] = 0;
  for (const row of rows) distribution[row._id] = row.count;
  return distribution;
}

export type TrafficDay = {
  date: string;
  successes: number;
  failures: number;
};

/**
 * Daily authentication traffic for the last `days` days.
 *
 * Bucketed in the database with $group rather than in JS, so the cost does
 * not grow with the size of the log collection.
 */
export async function getTrafficSeries(days = 14): Promise<TrafficDay[]> {
  await connectToDatabase();
  const since = new Date(Date.now() - days * DAY_MS);
  since.setUTCHours(0, 0, 0, 0);

  const rows = await AuthLogModel.aggregate<{
    _id: { date: string; success: boolean };
    count: number;
  }>([
    { $match: { createdAt: { $gte: since }, action: "LOGIN_SUCCESS" } },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          success: "$success",
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { "_id.date": 1 } },
  ]);

  // Pre-fill so the chart has a continuous axis even on quiet days.
  const byDate = new Map<string, { successes: number; failures: number }>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
    byDate.set(key, { successes: 0, failures: 0 });
  }
  for (const row of rows) {
    const bucket = byDate.get(row._id.date);
    if (!bucket) continue;
    if (row._id.success) bucket.successes += row.count;
    else bucket.failures += row.count;
  }

  return [...byDate.entries()].map(([date, value]) => ({ date, ...value }));
}

export type TopEntry = { label: string; count: number };

/** Most active source IPs — the fastest way to spot credential stuffing. */
export async function getTopIps(limit = 10): Promise<TopEntry[]> {
  await connectToDatabase();
  const rows = await AuthLogModel.aggregate<{ _id: string; count: number }>([
    { $match: { success: false, ip: { $ne: null } } },
    { $group: { _id: "$ip", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]);
  return rows.map((row) => ({ label: row._id, count: row.count }));
}

/** Usernames generating the most failed attempts. */
export async function getTopFailingUsernames(limit = 10): Promise<TopEntry[]> {
  await connectToDatabase();
  const rows = await AuthLogModel.aggregate<{ _id: string; count: number }>([
    { $match: { success: false, username: { $ne: null } } },
    { $group: { _id: "$username", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]);
  return rows.map((row) => ({ label: row._id, count: row.count }));
}

// ---------------------------------------------------------------------------
// Cross-tenant listings
// ---------------------------------------------------------------------------

export type AdminCustomer = {
  id: string;
  email: string;
  username: string;
  plan: string;
  planLabel: string;
  createdAt: string;
  lastLoginAt: string | null;
  applicationCount: number;
};

export async function listCustomers(
  options: PaginationInput,
): Promise<{ customers: AdminCustomer[]; total: number }> {
  await connectToDatabase();
  const skip = (options.page - 1) * options.limit;

  const filter: Record<string, unknown> = {};
  if (options.search) {
    const safe = options.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { email: { $regex: safe, $options: "i" } },
      { username: { $regex: safe, $options: "i" } },
    ];
  }

  const [users, total] = await Promise.all([
    UserModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(options.limit).lean(),
    UserModel.countDocuments(filter),
  ]);

  // One grouped query instead of an N+1 count per customer.
  const ids = users.map((user) => user._id);
  const grouped = await ApplicationModel.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { ownerId: { $in: ids } } },
    { $group: { _id: "$ownerId", count: { $sum: 1 } } },
  ]);
  const counts = new Map(grouped.map((row) => [row._id.toString(), row.count]));

  return {
    customers: users.map((user) => ({
      id: user._id.toString(),
      email: user.email,
      username: user.username,
      plan: getPlan(user.plan).id,
      planLabel: getPlan(user.plan).label,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      applicationCount: counts.get(user._id.toString()) ?? 0,
    })),
    total,
  };
}

export type AdminApplication = {
  id: string;
  name: string;
  appId: string;
  description: string;
  owner: { id: string; email: string; username: string };
  userCount: number;
  createdAt: string;
};

export async function listAllApplications(
  options: PaginationInput,
): Promise<{ applications: AdminApplication[]; total: number }> {
  await connectToDatabase();
  const skip = (options.page - 1) * options.limit;

  const filter: Record<string, unknown> = {};
  if (options.search) {
    const safe = options.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { name: { $regex: safe, $options: "i" } },
      { appId: { $regex: safe, $options: "i" } },
    ];
  }

  const [applications, total] = await Promise.all([
    ApplicationModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(options.limit).lean(),
    ApplicationModel.countDocuments(filter),
  ]);

  // Resolve owner details in one query rather than per row.
  const ownerIds = [...new Set(applications.map((app) => app.ownerId.toString()))];
  const owners = await UserModel.find({ _id: { $in: ownerIds } })
    .select("email username")
    .lean();
  const ownerMap = new Map(
    owners.map((owner) => [
      owner._id.toString(),
      { email: owner.email, username: owner.username },
    ]),
  );

  const appIds = applications.map((app) => app._id);
  const grouped = await AppUserModel.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { applicationId: { $in: appIds } } },
    { $group: { _id: "$applicationId", count: { $sum: 1 } } },
  ]);
  const counts = new Map(grouped.map((row) => [row._id.toString(), row.count]));

  return {
    applications: applications.map((app) => {
      const owner = ownerMap.get(app.ownerId.toString());
      return {
        id: app._id.toString(),
        name: app.name,
        appId: app.appId,
        description: app.description,
        owner: {
          id: app.ownerId.toString(),
          email: owner?.email ?? "(deleted)",
          username: owner?.username ?? "(deleted)",
        },
        userCount: counts.get(app._id.toString()) ?? 0,
        createdAt: app.createdAt.toISOString(),
      };
    }),
    total,
  };
}


export type AdminAppUser = {
  id: string;
  username: string;
  application: { id: string; name: string };
  isBanned: boolean;
  isExpired: boolean;
  expiresAt: string | null;
  maxDevices: number;
  lastLoginAt: string | null;
  createdAt: string;
};

export async function listAllAppUsers(
  options: PaginationInput & { status?: string },
): Promise<{ users: AdminAppUser[]; total: number }> {
  await connectToDatabase();
  const now = new Date();
  const filter: Record<string, unknown> = {};

  if (options.search) {
    const safe = options.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.username = { $regex: safe, $options: "i" };
  }
  if (options.status === "banned") filter.isBanned = true;
  if (options.status === "expired") filter.expiresAt = { $ne: null, $lte: now };
  if (options.status === "active") {
    filter.isBanned = false;
    filter.$or = [{ expiresAt: null }, { expiresAt: { $gt: now } }];
  }

  const skip = (options.page - 1) * options.limit;
  const [users, total] = await Promise.all([
    AppUserModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(options.limit).lean(),
    AppUserModel.countDocuments(filter),
  ]);

  const appIds = [...new Set(users.map((user) => user.applicationId.toString()))];
  const apps = await ApplicationModel.find({ _id: { $in: appIds } })
    .select("name")
    .lean();
  const appMap = new Map(apps.map((app) => [app._id.toString(), app.name]));

  return {
    users: users.map((user) => ({
      id: user._id.toString(),
      username: user.username,
      application: {
        id: user.applicationId.toString(),
        name: appMap.get(user.applicationId.toString()) ?? "(deleted)",
      },
      isBanned: user.isBanned,
      isExpired: user.expiresAt !== null && user.expiresAt.getTime() <= now.getTime(),
      expiresAt: user.expiresAt ? user.expiresAt.toISOString() : null,
      maxDevices: user.maxDevices,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      createdAt: user.createdAt.toISOString(),
    })),
    total,
  };
}

export type AdminDevice = {
  id: string;
  deviceId: string;
  application: string;
  user: string;
  platform: string | null;
  lastSeenAt: string;
  lastIp: string | null;
};

export async function listAllDevices(
  options: PaginationInput,
): Promise<{ devices: AdminDevice[]; total: number }> {
  await connectToDatabase();
  const skip = (options.page - 1) * options.limit;

  const [devices, total] = await Promise.all([
    DeviceModel.find({}).sort({ lastSeenAt: -1 }).skip(skip).limit(options.limit).lean(),
    DeviceModel.countDocuments({}),
  ]);

  const appIds = [...new Set(devices.map((d) => d.applicationId.toString()))];
  const userIds = [...new Set(devices.map((d) => d.userId.toString()))];

  const [apps, users] = await Promise.all([
    ApplicationModel.find({ _id: { $in: appIds } }).select("name").lean(),
    AppUserModel.find({ _id: { $in: userIds } }).select("username").lean(),
  ]);
  const appMap = new Map(apps.map((a) => [a._id.toString(), a.name]));
  const userMap = new Map(users.map((u) => [u._id.toString(), u.username]));

  return {
    devices: devices.map((device) => ({
      id: device._id.toString(),
      deviceId: device.deviceId,
      application: appMap.get(device.applicationId.toString()) ?? "(deleted)",
      user: userMap.get(device.userId.toString()) ?? "(deleted)",
      platform: device.metadata?.platform ?? null,
      lastSeenAt: device.lastSeenAt.toISOString(),
      lastIp: device.lastIp,
    })),
    total,
  };
}


export type AdminSession = {
  id: string;
  deviceId: string;
  application: string;
  user: string;
  ip: string | null;
  createdAt: string;
  expiresAt: string;
  isActive: boolean;
};

export async function listAllAppSessions(
  options: PaginationInput,
): Promise<{ sessions: AdminSession[]; total: number }> {
  await connectToDatabase();
  const skip = (options.page - 1) * options.limit;

  const [sessions, total] = await Promise.all([
    SessionModel.find({}).sort({ createdAt: -1 }).skip(skip).limit(options.limit).lean(),
    SessionModel.countDocuments({}),
  ]);

  const appIds = [...new Set(sessions.map((s) => s.applicationId.toString()))];
  const userIds = [...new Set(sessions.map((s) => s.userId.toString()))];

  const [apps, users] = await Promise.all([
    ApplicationModel.find({ _id: { $in: appIds } }).select("name").lean(),
    AppUserModel.find({ _id: { $in: userIds } }).select("username").lean(),
  ]);
  const appMap = new Map(apps.map((a) => [a._id.toString(), a.name]));
  const userMap = new Map(users.map((u) => [u._id.toString(), u.username]));

  return {
    sessions: sessions.map((session) => ({
      id: session._id.toString(),
      deviceId: session.deviceId,
      application: appMap.get(session.applicationId.toString()) ?? "(deleted)",
      user: userMap.get(session.userId.toString()) ?? "(deleted)",
      ip: session.ip,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      isActive: session.revokedAt === null && session.expiresAt.getTime() > Date.now(),
    })),
    total,
  };
}

export async function listAllAuthLogs(
  options: PaginationInput & { action?: string },
): Promise<{ logs: ReturnType<typeof toPublicAuthLog>[]; total: number }> {
  await connectToDatabase();
  const filter: Record<string, unknown> = {};
  if (options.action) filter.action = options.action as AuthActionValue;

  const skip = (options.page - 1) * options.limit;
  const [logs, total] = await Promise.all([
    AuthLogModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(options.limit).lean(),
    AuthLogModel.countDocuments(filter),
  ]);

  return { logs: logs.map(toPublicAuthLog), total };
}

export type AdminEvent = ReturnType<typeof toPublicAuthLog> & { application: string };

/** Most recent authentication events across every tenant. */
export async function getRecentPlatformEvents(limit = 15): Promise<AdminEvent[]> {
  await connectToDatabase();
  const logs = await AuthLogModel.find({}).sort({ createdAt: -1 }).limit(limit).lean();

  const appIds = [...new Set(logs.map((log) => log.applicationId.toString()))];
  const apps = await ApplicationModel.find({ _id: { $in: appIds } })
    .select("name")
    .lean();
  const appMap = new Map(apps.map((app) => [app._id.toString(), app.name]));

  return logs.map((log) => ({
    ...toPublicAuthLog(log),
    application: appMap.get(log.applicationId.toString()) ?? "(deleted)",
  }));
}
