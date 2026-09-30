"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Boxes, Plus, RefreshCw, Trash2, Pencil, KeyRound } from "lucide-react";

import { apiFetch, ApiClientError } from "@/lib/api-client";
import { Alert, Spinner, type AlertMessage } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import type { PublicApplication } from "@/models/Application";
import {
  ConfirmModal,
  CreateApplicationModal,
  EditApplicationModal,
  SecretRevealModal,
} from "./application-dialogs";

type ApplicationWithSecret = PublicApplication & { appSecret: string };

/**
 * Application management: create, rename, rotate secret, delete.
 *
 * Every action goes through the owner-scoped dashboard API, so the server
 * re-verifies ownership regardless of what this UI displays.
 */
export function ApplicationManager({
  applications,
  canCreate = true,
  planLabel = "",
}: {
  applications: PublicApplication[];
  /** False when the account has used every slot on its subscription plan. */
  canCreate?: boolean;
  planLabel?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PublicApplication | null>(null);
  const [deleting, setDeleting] = useState<PublicApplication | null>(null);
  const [rotating, setRotating] = useState<PublicApplication | null>(null);
  const [newSecret, setNewSecret] = useState<ApplicationWithSecret | null>(null);

  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<AlertMessage | null>(null);

  function close() {
    setAlert(null);
    setPending(false);
  }

  function fail(error: unknown, fallback: string) {
    // Hitting the plan limit is a normal business outcome, not a crash, so it
    // is surfaced as a warning with the server's explanation.
    const isLimit = error instanceof ApiClientError && error.code === "APP_LIMIT_REACHED";
    setAlert({
      variant: isLimit ? "warning" : "error",
      message: error instanceof ApiClientError ? error.message : fallback,
      fields: error instanceof ApiClientError ? error.details : undefined,
    });
    setPending(false);
  }

  async function handleCreate(values: { name: string; description: string }) {
    setPending(true);
    setAlert(null);
    try {
      const created = await apiFetch<ApplicationWithSecret>("/api/dashboard/applications", {
        method: "POST",
        body: values,
      });
      setCreating(false);
      setNewSecret(created);
      toast({ tone: "success", title: "Application created" });
      router.refresh();
    } catch (error) {
      fail(error, "Could not create the application.");
    }
  }

  async function handleUpdate(values: { name: string; description: string }) {
    if (!editing) return;
    setPending(true);
    setAlert(null);
    try {
      await apiFetch(`/api/dashboard/applications/${editing.id}`, {
        method: "PATCH",
        body: values,
      });
      toast({ tone: "success", title: "Application updated" });
      setEditing(null);
      close();
      router.refresh();
    } catch (error) {
      fail(error, "Could not update the application.");
    }
  }

  async function handleRotate() {
    if (!rotating) return;
    setPending(true);
    setAlert(null);
    try {
      const result = await apiFetch<ApplicationWithSecret>(
        `/api/dashboard/applications/${rotating.id}/rotate-secret`,
        { method: "POST" },
      );
      setRotating(null);
      close();
      setNewSecret(result);
      router.refresh();
    } catch (error) {
      fail(error, "Could not rotate the secret.");
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setPending(true);
    setAlert(null);
    try {
      await apiFetch(`/api/dashboard/applications/${deleting.id}`, { method: "DELETE" });
      toast({ tone: "success", title: `${deleting.name} deleted` });
      setDeleting(null);
      close();
      router.refresh();
    } catch (error) {
      fail(error, "Could not delete the application.");
    }
  }


  // Hoisted so the populated header and the empty state share one button.
  // Defining it inline per branch previously meant the empty state could
  // render no way to create the very first application.
  const createButton = (
    <button
      type="button"
      disabled={!canCreate}
      onClick={() => { setCreating(true); close(); }}
      title={canCreate ? undefined : `Your ${planLabel} plan has no application slots left.`}
      className="btn btn-md btn-primary"
    >
      <Plus className="h-4 w-4" />
      New application
    </button>
  );

  return (
    <>
      {applications.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No applications yet"
            description="Create an application to get an app id and secret you can use from your game or software."
            icon={Boxes}
            action={
              canCreate
                ? createButton
                : undefined // At the cap there is nothing to create; the banner above explains why.
            }
          />
        </div>
      ) : (
        <>
          <div className="flex justify-end">{createButton}</div>

          {!canCreate ? (
            <p className="mt-2 text-right text-[12px] text-warn-400">
              Your {planLabel} plan has no application slots left. Delete an application
              or contact support to upgrade.
            </p>
          ) : null}

          <div className="mt-4 space-y-3">
        {applications.map((app) => (
          <article key={app.id} className="card p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-400">
                    <Boxes className="h-4 w-4" />
                  </span>
                  <Link
                    href={`/dashboard/applications/${app.id}`}
                    className="truncate text-[15px] font-semibold text-ink hover:text-brand-300"
                  >
                    {app.name}
                  </Link>
                </div>
                {app.description ? (
                  <p className="mt-2 text-[13px] text-ink-muted">{app.description}</p>
                ) : null}
                <p className="mt-2 font-mono text-[11px] text-ink-subtle">
                  {app.appId} · secret ••••{app.appSecretFingerprint}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Link href={`/dashboard/applications/${app.id}`} className="btn btn-sm btn-secondary">
                  <KeyRound className="h-3.5 w-3.5" />
                  Open
                </Link>
                <button
                  type="button"
                  onClick={() => { setEditing(app); close(); }}
                  className="btn btn-sm btn-secondary"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => { setRotating(app); close(); }}
                  className="btn btn-sm btn-secondary"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Rotate
                </button>
                <button
                  type="button"
                  onClick={() => { setDeleting(app); close(); }}
                  className="btn btn-sm btn-danger-soft"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </div>
          </article>
        ))}
          </div>
        </>
      )}

      <CreateApplicationModal
        open={creating}
        onClose={() => setCreating(false)}
        onSubmit={handleCreate}
        alert={alert}
        footer={
          <>
            <button type="button" onClick={() => setCreating(false)} className="btn btn-sm btn-ghost">Cancel</button>
            <button type="submit" form="create-app" disabled={pending} className="btn btn-sm btn-primary">
              {pending ? <Spinner /> : null} Create
            </button>
          </>
        }
      />

      <EditApplicationModal
        application={editing}
        onClose={() => setEditing(null)}
        onSubmit={handleUpdate}
        alert={alert}
        footer={
          <>
            <button type="button" onClick={() => setEditing(null)} className="btn btn-sm btn-ghost">Cancel</button>
            <button type="submit" form="edit-app" disabled={pending} className="btn btn-sm btn-primary">
              {pending ? <Spinner /> : null} Save
            </button>
          </>
        }
      />

      <ConfirmModal
        open={rotating !== null}
        onClose={() => setRotating(null)}
        onConfirm={handleRotate}
        title="Rotate application secret"
        alert={alert}
        footer={
          <>
            <button type="button" onClick={() => setRotating(null)} className="btn btn-sm btn-ghost">Cancel</button>
            <button type="button" onClick={handleRotate} disabled={pending} className="btn btn-sm btn-primary">
              {pending ? <Spinner /> : null} Rotate
            </button>
          </>
        }
      >
        <Alert variant="warning">
          The current secret for <strong>{rotating?.name}</strong> stops working immediately.
          Clients still using it receive <code className="font-mono">INVALID_APP_SECRET</code>.
        </Alert>
      </ConfirmModal>

      <ConfirmModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete application"
        alert={alert}
        footer={
          <>
            <button type="button" onClick={() => setDeleting(null)} className="btn btn-sm btn-ghost">Cancel</button>
            <button type="button" onClick={handleDelete} disabled={pending} className="btn btn-sm btn-danger">
              {pending ? <Spinner /> : null} Delete permanently
            </button>
          </>
        }
      >
        <Alert variant="error">
          This permanently deletes <strong>{deleting?.name}</strong> along with all of its
          users, devices, sessions and logs. This cannot be undone.
        </Alert>
      </ConfirmModal>

      <SecretRevealModal
        application={newSecret}
        onClose={() => setNewSecret(null)}
        footer={
          <button type="button" onClick={() => setNewSecret(null)} className="btn btn-sm btn-primary">
            I have saved it
          </button>
        }
      />
    </>
  );
}
