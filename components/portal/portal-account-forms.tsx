"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, KeyRound, Monitor, Save, Trash2 } from "lucide-react";

import { apiFetch, ApiClientError } from "@/lib/api-client";
import { Alert, FieldError, Spinner, type AlertMessage } from "@/components/ui/alert";
import { ConfirmPasswordField, PasswordInput } from "@/components/ui/password-input";
import { useToast } from "@/components/ui/toast";
import type { PortalDevice, PortalProfile } from "./types";

/**
 * The interactive half of the portal dashboard.
 *
 * Server components render the read-only facts (expiry, seat usage, profile);
 * this owns the three things a person can actually DO: rename themselves,
 * change their password, and remove a device.
 *
 * Each action revalidates the server's view afterwards rather than assuming
 * what happened — in particular the device list, because whether a deletion was
 * allowed depends on the server's idle clock, not on anything decided here.
 */
export function PortalAccountForms({
  profile,
  devices,
  idleMinutes,
}: {
  profile: PortalProfile;
  devices: PortalDevice[];
  idleMinutes: number;
}) {
  return (
    <div className="w-full space-y-4 sm:space-y-6">
      <ProfileCard profile={profile} />
      <PasswordCard />
      <DevicesCard devices={devices} idleMinutes={idleMinutes} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function ProfileCard({ profile }: { profile: PortalProfile }) {
  const router = useRouter();
  const [name, setName] = useState(profile.name);
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<AlertMessage | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setAlert(null);
    setSaved(false);

    try {
      await apiFetch("/api/portal/me", { method: "PATCH", body: { name } });
      setSaved(true);
      router.refresh();
    } catch (error) {
      setAlert({
        variant: "error",
        message:
          error instanceof ApiClientError
            ? error.message
            : "Could not save your name.",
        fields: error instanceof ApiClientError ? error.details : undefined,
      });
    } finally {
      setPending(false);
    }
  }

  const dirty = name.trim() !== profile.name;

  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface-900 p-4 sm:p-5">
      <h2 className="text-[15px] font-semibold text-ink">Your details</h2>
      <p className="mt-0.5 text-[13px] text-ink-muted">
        Your username identifies your account and cannot be changed here.
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
        {alert ? <Alert {...alert} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="portal-username" className="label">
              Username
            </label>
            <input
              id="portal-username"
              value={profile.username}
              readOnly
              disabled
              className="input opacity-60"
            />
          </div>

          <div>
            <label htmlFor="portal-name" className="label">
              Display name
            </label>
            <input
              id="portal-name"
              name="name"
              type="text"
              required
              maxLength={80}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setSaved(false);
              }}
              className="input"
              placeholder="How should we call you?"
            />
            <FieldError message={alert?.fields?.name} />
          </div>
        </div>

        {/* Full-width on a phone — a 40px-tall target across the whole card is
            easier to hit than a 90px one — back to content width from `sm`. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="submit"
            disabled={pending || !dirty}
            className="btn btn-md btn-primary w-full sm:w-auto"
          >
            {pending ? <Spinner /> : <Save className="h-4 w-4" />}
            Save
          </button>
          {saved && !pending ? (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-brand-400">
              <Check className="h-3.5 w-3.5" />
              Saved
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

function PasswordCard() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<AlertMessage | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setAlert(null);
    setSaved(false);

    // Checked BEFORE the request, so a mismatch never reaches the network. The
    // server has no confirm field to compare against — this is the only place
    // the two can be compared, which is exactly why it must not be optional.
    if (newPassword !== confirmPassword) {
      setAlert({ variant: "error", message: "New passwords do not match." });
      setPending(false);
      return;
    }

    try {
      await apiFetch("/api/portal/password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSaved(true);
      router.refresh();
    } catch (error) {
      setAlert({
        variant: "error",
        message:
          error instanceof ApiClientError
            ? error.message
            : "Could not change your password.",
        fields: error instanceof ApiClientError ? error.details : undefined,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface-900 p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        <KeyRound className="h-4 w-4 shrink-0 text-ink-subtle" />
        Password
      </h2>
      <p className="mt-0.5 text-[13px] text-ink-muted">
        Changing your password signs you out on every other device.
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
        {alert ? <Alert {...alert} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="current-password" className="label">
              Current password
            </label>
            <PasswordInput
              id="current-password"
              name="currentPassword"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
            <FieldError message={alert?.fields?.currentPassword} />
          </div>

          <div>
            <label htmlFor="new-password" className="label">
              New password
            </label>
            <PasswordInput
              id="new-password"
              name="newPassword"
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => {
                setNewPassword(event.target.value);
                setSaved(false);
              }}
            />
            <FieldError message={alert?.fields?.newPassword} />
          </div>
        </div>

        {/* A second copy of the new password, so a typo cannot lock the person
            out of the account they are standing in. The comparison happens HERE
            and the value is never sent: the server has no field for it, and a
            secret that only ever existed in the browser should not be posted. */}
        <ConfirmPasswordField
          id="confirm-password"
          label="Confirm new password"
          password={newPassword}
          value={confirmPassword}
          onChange={setConfirmPassword}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="submit"
            disabled={pending || !currentPassword || !newPassword}
            className="btn btn-md btn-primary w-full sm:w-auto"
          >
            {pending ? <Spinner /> : <KeyRound className="h-4 w-4" />}
            Change password
          </button>
          {saved && !pending ? (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-brand-400">
              <Check className="h-3.5 w-3.5" />
              Updated
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

/** "just now" / "12 minutes ago" / "3 days ago" — no date library needed. */
function idleLabel(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function DevicesCard({
  devices,
  idleMinutes,
}: {
  devices: PortalDevice[];
  idleMinutes: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [alert, setAlert] = useState<AlertMessage | null>(null);

  async function onDelete(device: PortalDevice) {
    setBusy(device.id);
    setAlert(null);
    try {
      await apiFetch(`/api/portal/devices/${device.id}`, { method: "DELETE" });
      toast({ tone: "success", title: "Device removed." });
      // Re-read from the server: what is left, and what is now deletable, both
      // depend on the server's clock rather than anything decided here.
      router.refresh();
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? error.message
          : "Could not remove that device.";
      setAlert({ variant: "error", message });
      toast({ tone: "error", title: "Could not remove that device", description: message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface-900 p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        <Monitor className="h-4 w-4 shrink-0 text-ink-subtle" />
        Your devices
      </h2>
      <p className="mt-0.5 text-[13px] text-ink-muted">
        A device can be removed once it has been idle for {idleMinutes} minute
        {idleMinutes === 1 ? "" : "s"}. Removing one frees a seat and signs it out.
      </p>

      {alert ? (
        <div className="mt-4">
          <Alert {...alert} />
        </div>
      ) : null}

      {devices.length === 0 ? (
        <p className="mt-4 rounded-lg border border-line bg-surface-950 p-3.5 text-[13px] text-ink-muted">
          No devices registered yet. One appears here the first time you sign in
          from your app.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {devices.map((device) => (
            // Stacks on a phone so "Remove" is a full-width target rather than a
            // short one crammed beside a long device name. `min-w-0` on the text
            // side is what lets the name truncate instead of stretching the row.
            <li
              key={device.id}
              className="flex flex-col gap-3 rounded-lg border border-line bg-surface-950 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">
                  {device.deviceName || device.deviceId}
                </p>
                <p className="mt-0.5 truncate text-[12px] text-ink-subtle">
                  {device.deviceName ? `${device.deviceId} · ` : ""}
                  last active {idleLabel(device.idleMs)}
                </p>
              </div>

              <button
                type="button"
                onClick={() => onDelete(device)}
                disabled={!device.canDelete || busy === device.id}
                title={
                  device.canDelete
                    ? "Remove this device"
                    : `Active within the last ${idleMinutes} minutes — wait before removing.`
                }
                className="btn btn-md btn-ghost w-full shrink-0 text-danger-400 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
              >
                {busy === device.id ? <Spinner /> : <Trash2 className="h-4 w-4" />}
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}