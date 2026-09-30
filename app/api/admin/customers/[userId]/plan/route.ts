import { NextResponse } from "next/server";
import { z } from "zod";

import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { requireAdminIdentity } from "@/lib/admin-session";
import { setUserPlan } from "@/lib/plan-admin";
import { toObjectId } from "@/lib/authorization";
import { listPlans } from "@/lib/plans";

/**
 * PATCH /api/admin/customers/:userId/plan
 *
 * Moves a customer between subscription tiers. Operator-only.
 */
const bodySchema = z.object({
  plan: z.enum(["free", "starter", "pro", "unlimited"]),
});

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/admin/customers/[userId]/plan">,
): Promise<NextResponse> {
  try {
    const admin = await requireAdminIdentity();
    const { userId } = await ctx.params;
    toObjectId(userId, "customer id");

    const { plan } = bodySchema.parse(await readJsonBody<unknown>(request));
    const result = await setUserPlan(userId, plan, admin.email);

    return apiSuccess({ result, plans: listPlans() });
  } catch (error) {
    return handleApiError(error);
  }
}
