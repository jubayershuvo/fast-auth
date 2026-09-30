"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";

import { apiFetch, ApiClientError } from "@/lib/api-client";
import { Spinner, type AlertMessage } from "@/components/ui/alert";
import { useToast } from "@/components/ui/toast";
import { ConfirmModal } from "./application-dialogs";

/**
 * Edit a registered device: display name AND deviceId.
 *
 * Kept as a dialog rather than always-visible inputs so a long devices table
 * stays scannable — a field per row turns the table into a wall of inputs.
 *
 * The dialog spells out that changing the deviceId is not cosmetic: the client
 * identifies itself by that value, so afterwards it registers as a NEW device
 * and consumes another seat. Silently allowing that would look like a rename.
 */
export function DeviceEditButton({
  appId,
  device,
}: {
  appId: string;
  device: { id: string; deviceName: string | null; deviceId: string };
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [name, setName] = useState(device.deviceName ?? "");
  const [deviceId, setDeviceId] = useState(device.deviceId);
  const [alert, setAlert] = useState<AlertMessage | null>(null);

  // True only when the id actually differs, so the warning is not shown for a
  // pure rename.
  const idChanged = deviceId.trim() !== device.deviceId;
  const nameChanged = name.trim() !== (device.deviceName ?? "");

  async function handleSubmit() {
    const nextName = name.trim();
    const nextId = deviceId.trim();

    // Mirrors the server's zod rules so the user is told immediately rather
    // than after a round trip.
    if (nextName.length < 1 || nextName.length > 80) {
      setAlert({ variant: "error", message: "Device name must be 1–80 characters." });
      return;
    }
    if (nextId.length < 8 || nextId.length > 128) {
      setAlert({ variant: "error", message: "Device ID must be 8–128 characters." });
      return;
    }
    if (!/^[A-Za-z0-9._:-]+$/.test(nextId)) {
      setAlert({
        variant: "error",
        message: "Device ID may only contain letters, numbers, dots, dashes, colons and underscores.",
      });
      return;
    }
    if (!nameChanged && !idChanged) {
      setAlert({ variant: "error", message: "Nothing has changed." });
      return;
    }

    setPending(true);
    setAlert(null);
    try {
      // Send only what changed, so an untouched field can never be blanked by
      // a stale form value.
      const body: { deviceName?: string; deviceId?: string } = {};
      if (nameChanged) body.deviceName = nextName;
      if (idChanged) body.deviceId = nextId;

      await apiFetch(`/api/dashboard/applications/${appId}/devices/${device.id}`, {
        method: "PATCH",
        body,
      });
      setOpen(false);
      toast({ tone: "success", title: "Device updated" });
      router.refresh();
    } catch (error) {
      setAlert({
        variant: "error",
        message:
          error instanceof ApiClientError ? error.message : "Could not update the device.",
      });
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setName(device.deviceName ?? "");
          setDeviceId(device.deviceId);
          setOpen(true);
          setAlert(null);
        }}
        className="btn btn-sm btn-secondary"
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit
      </button>

      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={handleSubmit}
        title="Edit device"
        alert={alert}
        footer={
          <>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn btn-sm btn-ghost"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={pending}
              className="btn btn-sm btn-primary"
            >
              {pending ? <Spinner /> : null} Save changes
            </button>
          </>
        }
      >
        <label className="field-label" htmlFor={`device-name-${device.id}`}>
          Device name
        </label>
        <input
          id={`device-name-${device.id}`}
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Work laptop"
          maxLength={80}
          disabled={pending}
        />

        <label className="field-label" htmlFor={`device-id-${device.id}`}>
          Device ID
        </label>
        <input
          id={`device-id-${device.id}`}
          className="input font-mono"
          value={deviceId}
          onChange={(event) => setDeviceId(event.target.value)}
          maxLength={128}
          disabled={pending}
        />

        {/*
          Only when the id actually differs: a name change must not cry wolf,
          and an owner renaming a device should not have to read a warning
          about seats that are not being touched.
        */}
        {idChanged ? (
          <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-ink">
            The client identifies itself by this value at login. After the change, a
            client still sending the old ID registers as a{" "}
            <span className="font-medium">new device</span> and uses another seat from
            that user&apos;s limit. Current sessions are not affected.
          </p>
        ) : null}
      </ConfirmModal>
    </>
  );
}

/**
 * Per-device "remove" control for the devices table.
 *
 * Removing a device frees its seat AND revokes the sessions bound to it, so
 * that device stops authenticating immediately. The confirm dialog spells that
 * out, because "delete a row" reads as harmless and this is not.
 */
export function DeviceDeleteButton({
  appId,
  device,
}: {
  /** The application ObjectId used in the dashboard route. */
  appId: string;
  device: { id: string; deviceName: string | null; deviceId: string };
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<AlertMessage | null>(null);

  const label = device.deviceName ?? device.deviceId;

  async function handleDelete() {
    setPending(true);
    setAlert(null);
    try {
      await apiFetch(`/api/dashboard/applications/${appId}/devices/${device.id}`, {
        method: "DELETE",
      });
      setOpen(false);
      toast({ tone: "success", title: `${label} removed` });
      router.refresh();
    } catch (error) {
      setAlert({
        variant: "error",
        message:
          error instanceof ApiClientError
            ? error.message
            : "Could not remove the device.",
      });
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setAlert(null); }}
        className="btn btn-sm btn-danger-soft"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Remove
      </button>

      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={handleDelete}
        title="Remove this device?"
        alert={alert}
        footer={
          <>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn btn-sm btn-ghost"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="btn btn-sm btn-danger"
            >
              {pending ? <Spinner /> : null} Remove device
            </button>
          </>
        }
      >
        <p className="text-[13px] text-ink-muted">
          <span className="font-mono text-ink">{label}</span> will be removed and its
          device seat freed.
        </p>
        <p className="mt-3 text-[13px] text-ink-muted">
          Any active session on this device is revoked straight away, so it stops
          authenticating on its next request — it will not simply expire on its own.
        </p>
        <p className="mt-3 text-[12px] text-ink-subtle">
          The user is not banned and other devices keep working. If this machine logs
          in again it is re-registered and uses a seat again.
        </p>
      </ConfirmModal>
    </>
  );
}
