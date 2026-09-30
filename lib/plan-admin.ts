import "server-only";

import { Types } from "mongoose";

import { ApiError, ErrorCode } from "@/lib/errors";
import { connectToDatabase } from "@/lib/mongodb";
import { getPlan, isPlanId, type PlanId } from "@/lib/plans";
import { UserModel } from "@/models/User";
import { recordAuthEvent } from "@/lib/logger";

/**
 * Operator-side plan management.
 *
 * No billing gateway is integrated: the main administrator moves an account
 * between tiers directly, which is what a real deployment would drive from a
 * Stripe webhook.
 */

export type PlanChangeResult = {
  userId: string;
  plan: PlanId;
  planLabel: string;
  changed: boolean;
  /** Set when the account is now above its cap after a downgrade. */
  overLimit: boolean;
  used: number;
  limit: number | null;
};

export async function setUserPlan(
  userId: string,
  plan: PlanId,
  changedBy: string,
): Promise<PlanChangeResult> {
  if (!isPlanId(plan)) {
    throw new ApiError(400, ErrorCode.INVALID_PLAN, "Unknown subscription plan.");
  }

  await connectToDatabase();

  const user = await UserModel.findById(new Types.ObjectId(userId));
  if (!user) throw ApiError.notFound("Customer not found.");

  const previous = getPlan(user.plan);
  const next = getPlan(plan);
  const changed = previous.id !== next.id;

  if (changed) {
    user.plan = plan;
    user.planChangedAt = new Date();
    user.planChangedBy = changedBy;
    await user.save();
  }

  // Usage is read from the applications collection rather than a counter, so it
  // can never drift out of sync with reality.
  const { ApplicationModel } = await import("@/models/Application");
  const used = await ApplicationModel.countDocuments({ ownerId: user._id });
  const overLimit = next.appLimit !== null && used > next.appLimit;

  if (changed) {
    await recordAuthEvent({
      // A plan change is not tenant-scoped, so this is written against the
      // customer's first application when one exists purely for the audit log.
      applicationId: await firstApplicationId(user._id),
      username: user.username,
      action: "USER_UPDATED",
      success: true,
      reason: `PLAN_${previous.id.toUpperCase()}_TO_${next.id.toUpperCase()}`,
    });
  }

  return {
    userId: user._id.toString(),
    plan: next.id,
    planLabel: next.label,
    changed,
    overLimit,
    used,
    limit: next.appLimit,
  };
}

/** The AuthLog requires an applicationId; fall back gracefully if none. */
async function firstApplicationId(userId: Types.ObjectId): Promise<Types.ObjectId | string> {
  const { ApplicationModel } = await import("@/models/Application");
  const app = await ApplicationModel.findOne({ ownerId: userId }).select("_id").lean();
  if (app) return app._id;
  // No application yet: use a zero ObjectId, which simply groups the event
  // under a "no application" bucket rather than dropping the audit entry.
  return new Types.ObjectId("000000000000000000000000");
}

/** Plan + usage for every customer (admin overview). */
export async function getAllPlanSummaries(): Promise<
  Array<{ plan: PlanId; count: number }>
> {
  await connectToDatabase();
  const rows = await UserModel.aggregate<{ _id: PlanId; count: number }>([
    { $group: { _id: "$plan", count: { $sum: 1 } } },
  ]);
  return rows.map((row) => ({ plan: row._id, count: row.count }));
}
