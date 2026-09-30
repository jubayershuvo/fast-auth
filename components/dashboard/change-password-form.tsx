"use client";

import { useState, type FormEvent } from "react";

import { apiFetch, ApiClientError } from "@/lib/api-client";
import { Alert, Spinner, type AlertMessage } from "@/components/ui/alert";
import { ConfirmPasswordField, PasswordInput } from "@/components/ui/password-input";
import { useToast } from "@/components/ui/toast";

export function ChangePasswordForm() {
  const { toast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<AlertMessage | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();

    // The shared field warns while typing; this stops the request going out at
    // all, which matters because `required` alone would not catch a mistyped
    // confirmation — the browser only checks that it is NON-empty.
    if (next !== confirm) {
      setAlert({ variant: "error", message: "New passwords do not match." });
      return;
    }

    setPending(true);
    setAlert(null);
    try {
      await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: { currentPassword: current, newPassword: next },
      });
      toast({ tone: "success", title: "Password updated" });
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (error) {
      setAlert({
        variant: "error",
        message: error instanceof ApiClientError ? error.message : "Could not update the password.",
        fields: error instanceof ApiClientError ? error.details : undefined,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-sm space-y-4">
      {alert ? <Alert {...alert} /> : null}
      <div>
        <label htmlFor="current-password" className="label">Current password</label>
        <PasswordInput
          id="current-password"
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="new-password" className="label">New password</label>
        <PasswordInput
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </div>
      {/*
        The shared field rather than another hand-rolled confirm box: it shows the
        mismatch while typing, not only after a failed submit, and it keeps this
        form consistent with set-password, forgot-password and the portal form.
      */}
      <ConfirmPasswordField
        id="confirm-password"
        label="Confirm new password"
        password={next}
        value={confirm}
        onChange={setConfirm}
        minLength={8}
      />
      <button type="submit" disabled={pending} className="btn btn-md btn-primary">
        {pending ? <Spinner /> : null}
        Update password
      </button>
    </form>
  );
}
