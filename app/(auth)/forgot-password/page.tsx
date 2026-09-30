import { Suspense } from "react";
import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Reset your password",
};

/**
 * Password recovery.
 *
 * Suspense for the same reason as /set-password: the form reads `?email=` via
 * `useSearchParams`, which forces the subtree client-rendered, so the static
 * prerender fails without a boundary.
 */
export default function ForgotPasswordPage() {
  return (
    <div>
      <header className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          We&apos;ll email you a code to choose a new one.
        </p>
      </header>
      <Suspense fallback={null}>
        <ForgotPasswordForm />
      </Suspense>
    </div>
  );
}