import { Suspense } from "react";
import type { Metadata } from "next";

import { SetPasswordForm } from "@/components/auth/set-password-form";

export const metadata: Metadata = {
  title: "Set a password",
};

/**
 * The page is a Suspense boundary because `SetPasswordForm` reads the `?email=`
 * search param, and `useSearchParams` forces the whole subtree to be
 * client-rendered. Without this, the static prerender fails at build time.
 */
export default function SetPasswordPage() {
  return (
    <div>
      <header className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">Set a password</h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          For accounts created by an operator or a social sign-in.
        </p>
      </header>
      <Suspense fallback={null}>
        <SetPasswordForm />
      </Suspense>
    </div>
  );
}
