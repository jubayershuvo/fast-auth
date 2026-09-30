import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";
import { SocialAuthButtons } from "@/components/auth/social-auth-buttons";
import { listEnabledProviders } from "@/lib/oauth-config";
import { isEmailPasswordEnabled } from "@/lib/auth-method";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage() {
  // Only providers the operator has enabled AND fully configured appear here.
  const providers = await listEnabledProviders("customer");
  // And the password form only when the operator has left email+password on.
  // Hiding it is a convenience; the server enforces it either way.
  const passwordEnabled = await isEmailPasswordEnabled();

  return (
    <div>
      <header className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          Sign in to manage your applications and users.
        </p>
      </header>
      <div className="space-y-6">
        {passwordEnabled ? <LoginForm providers={providers} /> : null}
        <SocialAuthButtons
          providers={providers}
          realm="customer"
          action="Sign in"
        />
        {!passwordEnabled && providers.length === 0 ? (
          <p className="text-[13px] text-ink-muted">
            No sign-in method is currently available. Please contact your
            administrator.
          </p>
        ) : null}
      </div>
    </div>
  );
}

