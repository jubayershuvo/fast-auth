/**
 * Subscription plan catalogue — PURE DATA, no server-only, no I/O.
 *
 * This module is imported by both server services and client components (the
 * plan picker renders the same catalogue the server enforces), so it must
 * stay isomorphic. Anything that touches the database belongs in
 * lib/plans.ts instead.
 */

export const PLAN_IDS = ["free", "starter", "pro", "unlimited"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** `null` means unlimited. */
export type AppLimit = number | null;

export type Plan = {
  id: PlanId;
  label: string;
  /** Maximum applications allowed. `null` = unlimited. */
  appLimit: AppLimit;
  /** Display-only price. No billing gateway is integrated. */
  priceLabel: string;
  tagline: string;
  features: string[];
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    label: "Free",
    appLimit: 2,
    priceLabel: "$0",
    tagline: "Everything you need to try FastAuth.",
    features: ["Up to 2 applications", "Full user management", "Device limits & bans", "Audit logs"],
  },
  starter: {
    id: "starter",
    label: "Starter",
    appLimit: 10,
    priceLabel: "$19/mo",
    tagline: "For a product with a real user base.",
    features: ["Up to 10 applications", "Everything in Free", "Priority support"],
  },
  pro: {
    id: "pro",
    label: "Pro",
    appLimit: 20,
    priceLabel: "$49/mo",
    tagline: "For studios shipping several titles.",
    features: ["Up to 20 applications", "Everything in Starter", "Priority support"],
  },
  unlimited: {
    id: "unlimited",
    label: "Unlimited",
    appLimit: null,
    priceLabel: "Custom",
    tagline: "No application ceiling.",
    features: ["Unlimited applications", "Everything in Pro", "Dedicated support"],
  },
};

export const DEFAULT_PLAN: PlanId = "free";

export function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value);
}

export function getPlan(id: string | null | undefined): Plan {
  return id != null && isPlanId(id) ? PLANS[id] : PLANS[DEFAULT_PLAN];
}

export function listPlans(): Plan[] {
  return PLAN_IDS.map((id) => PLANS[id]);
}

/** Human label for an application count against a plan's cap. */
export function describeLimit(limit: AppLimit): string {
  return limit === null ? "Unlimited" : `${limit} application${limit === 1 ? "" : "s"}`;
}
