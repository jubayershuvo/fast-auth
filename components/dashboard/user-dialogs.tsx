"use client";

import { type FormEvent, type ReactNode } from "react";

import { Modal } from "@/components/ui/modal";
import { Alert, type AlertMessage } from "@/components/ui/alert";

export const DAY_PRESETS = [1, 7, 30, 90] as const;

/** Convert N days from now into an ISO instant the API accepts. */
export function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="label">{label}</p>
      {children}
      {hint ? <p className="mt-1.5 text-[12px] text-ink-subtle">{hint}</p> : null}
    </div>
  );
}

export function ExpiryPicker({
  value,
  onChange,
}: {
  value: "lifetime" | number;
  onChange: (value: "lifetime" | number) => void;
}) {
  return (
    <Field label="Expiration" hint="The account is rejected once this instant passes.">
      <div className="flex flex-wrap items-center gap-2">
        {DAY_PRESETS.map((days) => (
          <button
            key={days}
            type="button"
            onClick={() => onChange(days)}
            className={`btn btn-sm ${value === days ? "btn-primary" : "btn-secondary"}`}
          >
            {days} day{days > 1 ? "s" : ""}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange("lifetime")}
          className={`btn btn-sm ${value === "lifetime" ? "btn-primary" : "btn-secondary"}`}
        >
          Lifetime
        </button>
      </div>
    </Field>
  );
}

export type CreateUserFormProps = {
  name: string;
  username: string;
  password: string;
  maxDevices: number;
  expiry: "lifetime" | number;
  setName: (value: string) => void;
  setUsername: (value: string) => void;
  setPassword: (value: string) => void;
  setMaxDevices: (value: number) => void;
  setExpiry: (value: "lifetime" | number) => void;
  onSubmit: (event: FormEvent) => void;
};

export function CreateUserModal({
  open,
  onClose,
  alert,
  footer,
  form,
}: {
  open: boolean;
  onClose: () => void;
  alert: AlertMessage | null;
  footer: ReactNode;
  form: CreateUserFormProps;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New application user"
      description="This account lives only inside the current application."
      footer={footer}
    >
      <form id="create-user" onSubmit={form.onSubmit} className="space-y-4">
        {alert ? <Alert {...alert} /> : null}
        <Field label="Full name" hint="Shown in your user list. The username below is what the player types to sign in.">
          <input
            className="input"
            required
            maxLength={80}
            autoComplete="off"
            value={form.name}
            onChange={(e) => form.setName(e.target.value)}
            placeholder="Ada Lovelace"
          />
        </Field>
        <Field label="Username">
          <input
            className="input"
            required
            minLength={3}
            maxLength={32}
            value={form.username}
            onChange={(e) => form.setUsername(e.target.value)}
            placeholder="player123"
          />
        </Field>
        {/*
          No `minLength` here, deliberately.

          This is an APPLICATION end user, not a dashboard customer, and the
          server already says so: `appUserPasswordSchema` requires only that a
          password be non-empty and inside bcrypt's byte cap — it imposes no
          length and no character classes. The `minLength={8}` that used to sit
          here was the browser's own bubble, and it was the ONLY place this rule
          existed: it rejected the form before the request was ever made, so
          removing it changes nothing server-side and nothing is now enforced
          twice. Owners scripting bulk imports of existing game accounts could
          not create a user whose password they already had.
        */}
        <Field label="Password" hint="Any non-empty password. Shown as you type, so check it carefully — it is not shown again.">
          <input
            className="input"
            type="text"
            required
            value={form.password}
            onChange={(e) => form.setPassword(e.target.value)}
            placeholder="Secret123"
          />
        </Field>
        <Field label="Maximum devices" hint="How many devices may activate this licence at once.">
          <input
            className="input tnum"
            type="number"
            min={1}
            max={100}
            value={form.maxDevices}
            onChange={(e) => form.setMaxDevices(Number.parseInt(e.target.value, 10) || 1)}
          />
        </Field>
        <ExpiryPicker value={form.expiry} onChange={form.setExpiry} />
      </form>
    </Modal>
  );
}

/** Generic single-action dialog used for ban / extend / delete. */
export function ActionDialog({
  open,
  onClose,
  title,
  children,
  footer,
  alert,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer: ReactNode;
  alert: AlertMessage | null;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={footer}>
      <div className="space-y-4">
        {alert ? <Alert {...alert} /> : null}
        {children}
      </div>
    </Modal>
  );
}
