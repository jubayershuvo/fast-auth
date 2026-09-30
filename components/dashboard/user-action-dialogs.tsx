"use client";

import { Spinner, type AlertMessage } from "@/components/ui/alert";
import { ActionDialog, DAY_PRESETS, Field } from "./user-dialogs";
import type { PublicAppUser } from "@/models/AppUser";

export type UserAction =
  | { kind: "ban"; user: PublicAppUser }
  | { kind: "extend"; user: PublicAppUser }
  | { kind: "delete"; user: PublicAppUser };

/** Ban dialog: reason + optional session revocation. */
export function BanUserDialog({
  action,
  alert,
  pending,
  reason,
  revokeSessions,
  onReasonChange,
  onRevokeChange,
  onClose,
  onConfirm,
}: {
  action: UserAction | null;
  alert: AlertMessage | null;
  pending: boolean;
  reason: string;
  revokeSessions: boolean;
  onReasonChange: (value: string) => void;
  onRevokeChange: (value: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (action?.kind !== "ban") return null;
  const { user } = action;

  return (
    <ActionDialog
      open
      onClose={onClose}
      title={`Ban ${user.username}`}
      alert={alert}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn btn-sm btn-ghost">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={pending} className="btn btn-sm btn-danger">
            {pending ? <Spinner /> : null} Ban user
          </button>
        </>
      }
    >
      <Field label="Reason" hint="Recorded in the audit log for your support team.">
        <input
          className="input"
          maxLength={280}
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="Chargeback fraud"
        />
      </Field>
      <label className="flex items-start gap-2.5 text-[13px] text-ink-muted">
        <input
          type="checkbox"
          checked={revokeSessions}
          onChange={(e) => onRevokeChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-line-strong bg-surface-950"
        />
        Revoke all active sessions immediately
      </label>
    </ActionDialog>
  );
}

/** Extend dialog: period + whether to count from now or the previous expiry. */
export function ExtendUserDialog({
  action,
  alert,
  pending,
  days,
  from,
  onDaysChange,
  onFromChange,
  onClose,
  onConfirm,
}: {
  action: UserAction | null;
  alert: AlertMessage | null;
  pending: boolean;
  days: number;
  from: "now" | "previous";
  onDaysChange: (value: number) => void;
  onFromChange: (value: "now" | "previous") => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (action?.kind !== "extend") return null;
  const { user } = action;

  return (
    <ActionDialog
      open
      onClose={onClose}
      title={`Extend ${user.username}`}
      alert={alert}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn btn-sm btn-ghost">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={pending} className="btn btn-sm btn-primary">
            {pending ? <Spinner /> : null} Extend
          </button>
        </>
      }
    >
      <Field label="Period">
        <div className="flex flex-wrap gap-2">
          {DAY_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onDaysChange(preset)}
              className={`btn btn-sm ${days === preset ? "btn-primary" : "btn-secondary"}`}
            >
              {preset} days
            </button>
          ))}
        </div>
      </Field>
      <Field
        label="Count from"
        hint="“Previous expiry” restores an expired licence for its full remaining term."
      >
        <select
          className="input"
          value={from}
          onChange={(e) => onFromChange(e.target.value as "now" | "previous")}
        >
          <option value="now">From now</option>
          <option value="previous">From previous expiry</option>
        </select>
      </Field>
    </ActionDialog>
  );
}
