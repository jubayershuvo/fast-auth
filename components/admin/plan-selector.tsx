"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { listPlans, type PlanId } from "@/lib/plan-catalog";
import type { AdminCustomer } from "@/lib/admin-data";

/**
 * Inline plan selector for one customer.
 *
 * Changing a plan is instant and irreversible from the UI's perspective, so the
 * select applies on change and reports the result via a toast. The operator
 * sees the resulting usage immediately after the refresh.
 */
export function PlanSelector({
  customer,
}: {
  customer: AdminCustomer;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  async function change(next: string) {
    if (next === customer.plan) return;
    setPending(true);
    try {
      const result = await apiFetch<{
        result: {
          planLabel: string;
          changed: boolean;
          overLimit: boolean;
          used: number;
          limit: number | null;
        };
      }>(`/api/admin/customers/${customer.id}/plan`, {
        method: "PATCH",
        body: { plan: next },
      });

      const { planLabel, overLimit, used, limit } = result.result;
      toast({
        tone: overLimit ? "warning" : "success",
        title: `${customer.email} is now on ${planLabel}`,
        description: overLimit
          ? `Over the new limit: ${used} applications vs ${limit} allowed. They must delete one before creating another.`
          : `${used} of ${limit ?? "∞"} applications used.`,
      });
      router.refresh();
    } catch (error) {
      toast({
        tone: "error",
        title: "Could not change plan",
        description: error instanceof ApiClientError ? error.message : undefined,
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={customer.plan}
        disabled={pending}
        onChange={(event) => change(event.target.value)}
        aria-label={`Subscription plan for ${customer.email}`}
        className={cn(
          "h-8 rounded-lg border border-line-strong bg-surface-950 px-2 text-[13px]",
          "focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500",
          pending && "opacity-60",
        )}
      >
        {listPlans().map((plan) => (
          <option key={plan.id} value={plan.id}>
            {plan.label} ({plan.appLimit ?? "∞"})
          </option>
        ))}
      </select>
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-subtle" /> : null}
    </div>
  );
}

export type { AdminCustomer, PlanId };
