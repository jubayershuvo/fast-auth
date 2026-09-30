"use client";

import { useState, type FormEvent } from "react";

import { Modal } from "@/components/ui/modal";
import { Alert, type AlertMessage } from "@/components/ui/alert";
import { CopyableField } from "@/components/ui/copyable-field";
import type { PublicApplication } from "@/models/Application";

/** Shared create/edit form fields. */
function AppFields({
  name,
  description,
  onName,
  onDescription,
}: {
  name: string;
  description: string;
  onName: (value: string) => void;
  onDescription: (value: string) => void;
}) {
  return (
    <>
      <div>
        <label className="label" htmlFor="app-name">Name</label>
        <input
          id="app-name"
          required
          maxLength={64}
          value={name}
          onChange={(e) => onName(e.target.value)}
          className="input"
          placeholder="MyGame"
        />
      </div>
      <div>
        <label className="label" htmlFor="app-description">Description (optional)</label>
        <textarea
          id="app-description"
          rows={3}
          maxLength={280}
          value={description}
          onChange={(e) => onDescription(e.target.value)}
          className="input h-auto py-2"
          placeholder="What this application is for"
        />
      </div>
    </>
  );
}

export function CreateApplicationModal({
  open,
  onClose,
  onSubmit,
  footer,
  alert,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: { name: string; description: string }) => void;
  footer: React.ReactNode;
  alert: AlertMessage | null;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ name, description });
  }

  function handleClose() {
    setName("");
    setDescription("");
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="New application"
      description="We generate a public app id and a secret key for you."
      footer={footer}
    >
      <form id="create-app" onSubmit={handleSubmit} className="space-y-4">
        {alert ? <Alert {...alert} /> : null}
        <AppFields
          name={name}
          description={description}
          onName={setName}
          onDescription={setDescription}
        />
      </form>
    </Modal>
  );
}

export function EditApplicationModal({
  application,
  onClose,
  onSubmit,
  footer,
  alert,
}: {
  application: PublicApplication | null;
  onClose: () => void;
  onSubmit: (values: { name: string; description: string }) => void;
  footer: React.ReactNode;
  alert: AlertMessage | null;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [seededFor, setSeededFor] = useState<string | null>(null);

  // Re-seed fields when a different application is opened for editing.
  if (application && seededFor !== application.id) {
    setSeededFor(application.id);
    setName(application.name);
    setDescription(application.description);
  }

  return (
    <Modal
      open={application !== null}
      onClose={onClose}
      title="Edit application"
      footer={footer}
    >
      <form
        id="edit-app"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ name, description });
        }}
        className="space-y-4"
      >
        {alert ? <Alert {...alert} /> : null}
        <AppFields
          name={name}
          description={description}
          onName={setName}
          onDescription={setDescription}
        />
      </form>
    </Modal>
  );
}

/** Confirmation dialog for the two irreversible actions. */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  children,
  footer,
  alert,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  alert: AlertMessage | null;
}) {
  // Expose onConfirm to keyboard activation (Enter on the dialog) so the
  // destructive path is reachable without a pointer.
  return (
    <div
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === "Enter") onConfirm();
      }}
    >
      <Modal open={open} onClose={onClose} title={title} size="sm" footer={footer}>
        <div className="space-y-3">
          {alert ? <Alert {...alert} /> : null}
          {children}
        </div>
      </Modal>
    </div>
  );
}

/** One-time secret reveal — the only time the plaintext is ever shown. */
export function SecretRevealModal({
  application,
  onClose,
  footer,
}: {
  application: (PublicApplication & { appSecret: string }) | null;
  onClose: () => void;
  footer: React.ReactNode;
}) {
  return (
    <Modal open={application !== null} onClose={onClose} title="Save your secret now" size="lg" footer={footer}>
      <div className="space-y-4">
        <Alert variant="warning">
          This secret is shown <strong>once</strong> and is not recoverable. Store it in
          your server-side configuration, never in client-side code.
        </Alert>
        {application ? (
          <>
            <CopyableField label="Application ID" value={application.appId} />
            <CopyableField
              label="Application secret"
              value={application.appSecret}
              tone="warning"
              hint="Send this as `appSecret` in login requests for extra security."
            />
          </>
        ) : null}
      </div>
    </Modal>
  );
}
