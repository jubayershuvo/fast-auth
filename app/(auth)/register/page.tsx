import type { Metadata } from "next";

import { RegisterForm } from "@/components/auth/register-form";
import { SocialAuthButtons } from "@/components/auth/social-auth-buttons";
import { listEnabledProviders } from "@/lib/oauth-config";

export const metadata: Metadata = {
  title: "Create account",
};

export default async function RegisterPage() {
  const providers = await listEnabledProviders("customer");

  return (
    <div>
      <header className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          Start issuing licenses for your applications.
        </p>
      </header>
      <div className="space-y-6">
        <RegisterForm />
        <SocialAuthButtons providers={providers} realm="customer" action="Sign up" />
      </div>
    </div>
  );
}
