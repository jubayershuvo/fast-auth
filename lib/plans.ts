import "server-only";

import { Types } from "mongoose";

import { ApiError, ErrorCode } from "@/lib/errors";
import { connectToDatabase } from "@/lib/mongodb";
import { ApplicationModel } from "@/models/Application";
import { UserModel } from "@/models/User";
import { getPlan, type AppLimit, type Plan } from "@/lib/plan-catalog";

/**
 * Server-side plan usage + enforcement.
 *
 * The plan catalogue itself lives in lib/plan-catalog.ts (isomorphic, so the
 * client can render the same tiers the server enforces). Everything that reads
 * the database is here.
 *
 * Every new account — including OAuth-created ones — defaults to the free plan.
 */

// Single import site for server code.
export {
  PLANS,
  PLAN_IDS,
  DEFAULT_PLAN,
  isPlanId,
  getPlan,
  listPlans,
  describeLimit,
  type Plan,
  type PlanId,
  type AppLimit,
} from "@/lib/plan-catalog";

export type PlanUsage = {
  plan: Plan;
  used: number;
  limit: AppLimit;
  remaining: AppLimit;
  /** True when the account is above its current cap (after a downgrade). */
  overLimit: boolean;
  canCreate: boolean;
};

/** Current plan + application usage for an account. */
export async function getPlanUsage(ownerId: string): Promise<PlanUsage> {
  await connectToDatabase();
  const user = await UserModel.findById(new Types.ObjectId(ownerId))
    .select("plan")
    .lean();

  const plan = getPlan(user?.plan);
  const used = await ApplicationModel.countDocuments({
    ownerId: new Types.ObjectId(ownerId),
  });

  const remaining =
    plan.appLimit === null ? null : Math.max(0, plan.appLimit - used);

  return {
    plan,
    used,
    limit: plan.appLimit,
    remaining,
    overLimit: plan.appLimit !== null && used > plan.appLimit,
    canCreate: plan.appLimit === null || used < plan.appLimit,
  };
}

/**
 * Throw when the account has no application seats left.
 *
 * A DOWNGRADE never deletes applications. The account simply drops to
 * `overLimit` and cannot create anything new until the owner deletes
 * something, which is the standard and least destructive behaviour.
 */
export async function assertCanCreateApplication(ownerId: string): Promise<PlanUsage> {
  const usage = await getPlanUsage(ownerId);
  if (!usage.canCreate) {
    throw new ApiError(
      403,
      ErrorCode.APP_LIMIT_REACHED,
      `Your ${usage.plan.label} plan allows ${usage.limit} application${
        usage.limit === 1 ? "" : "s"
      } and you already have ${usage.used}. Upgrade your plan or delete an application.`,
    );
  }
  return usage;
}
