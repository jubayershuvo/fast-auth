"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { apiFetch, ApiClientError } from "@/lib/api-client";
import { Alert, FieldError, Spinner, type AlertMessage } from "@/components/ui/alert";
import { useToast } from "@/components/ui/toast";

/**
 * Edit the signed-in customer's display name.
 *
 * The only editable profile field. Email and username are rendered read-only
 * beside it on purpose: both are identity fields with their own uniqueness rules
 * and recovery flows, and quietly letting them be edited here is how people end
 * up locked out of their own account.
 */
export function ProfileNameForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const { toast } = useToast();

  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<AlertMessage | null>(null);

  // Another tab changed it, or the router re-rendered with a new value.
  const dirty = name.trim() !== initialName;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 80) {
      setAlert({ variant: "error", message: "Name must be 1–80 characters." });
      return;
    }

    setPending(true);
    setAlert(null);
    try {
      await apiFetch("/api/auth/profile", { method: "PATCH", body: { name: trimmed } });
      setName(trimmed);
      toast({ tone: "success", title: "Name updated" });
      router.refresh();
    } catch (error) {
      setAlert({
        variant: "error",
        message:
          error instanceof ApiClientError ? error.message : "Could not update your name.",
        fields: error instanceof ApiClientError ? error.details : undefined,
      });
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-4 max-w-sm space-y-2">
      {alert ? <Alert {...alert} /> : null}
      <label htmlFor="profile-name" className="label">
        Full name
      </label>
      <input
        id="profile-name"
        className="input"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={80}
        autoComplete="name"
        disabled={pending}
      />
      <FieldError message={alert?.fields?.name} />
      <button
        type="submit"
        disabled={pending || !dirty}
        className="btn btn-sm btn-primary"
      >
        {pending ? <Spinner /> : null} Save name
      </button>
    </form>
  );
}
