"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play } from "lucide-react";

import { apiFetch, ApiClientError } from "@/lib/api-client";
import { Spinner, type AlertMessage } from "@/components/ui/alert";
import { useToast } from "@/components/ui/toast";
import { ConfirmModal } from "./application-dialogs";

/**
 * Stop / Start for the whole application.
 *
 * Stopping refuses every /api/v1 authentication call — new logins AND sessions
 * that are already live — until the app is started again. Nothing is deleted,
 * so pressing Start restores the previous state with users still signed in.
 *
 * Confirmation is required, and it names the consequences in the terms an owner
 * cares about. "Stop" reads like a pause button; the effect is every customer
 * of the app being locked out at once, so that has to be spelled out.
 */
export function ApplicationStatusToggle({
  appId,
  status,
}: {
  appId: string;
  status: "active" | "suspended";
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<AlertMessage | null>(null);

  const suspended = status === "suspended";

  async function toggle() {
    const next = suspended ? "active" : "suspended";
    setPending(true);
    setAlert(null);
    try {
      await apiFetch(`/api/dashboard/applications/${appId}/status`, {
        method: "PATCH",
        body: { status: next },
      });
      setOpen(false);
      toast({
        tone: next === "active" ? "success" : "warning",
        title: next === "active" ? "Application started" : "Application stopped",
      });
      router.refresh();
    } catch (error) {
      setAlert({
        variant: "error",
        message:
          error instanceof ApiClientError
            ? error.message
            : "Could not change the application status.",
      });
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setAlert(null); }}
        className={suspended ? "btn btn-sm btn-primary" : "btn btn-sm btn-secondary"}
      >
        {suspended ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        {suspended ? "Start application" : "Stop application"}
      </button>

      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={toggle}
        title={suspended ? "Start this application?" : "Stop this application?"}
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
              onClick={toggle}
              disabled={pending}
              className={suspended ? "btn btn-sm btn-primary" : "btn btn-sm btn-danger"}
            >
              {pending ? <Spinner /> : null}
              {suspended ? "Start application" : "Stop application"}
            </button>
          </>
        }
      >
        {suspended ? (
          <p className="text-[13px] text-ink-muted">
            Sign-in will start working again immediately. Nobody needs to log in
            again — existing sessions were kept, not cancelled.
          </p>
        ) : (
          <>
            <p className="text-[13px] text-ink-muted">
              While stopped, your end users cannot sign in. Any request that
              checks a session is refused straight away with{" "}
              <span className="font-mono text-ink">503 APP_SUSPENDED</span>.
            </p>
            <p className="mt-3 text-[13px] text-ink-muted">
              This includes users who are already signed in, so the app appears
              broken to them until you start it again.
            </p>
            <p className="mt-3 text-[12px] text-ink-subtle">
              Nothing is deleted. Users, devices and sessions are all kept, and
              the dashboard stays available so you can press Start again.
            </p>
          </>
        )}
      </ConfirmModal>
    </>
  );
}
