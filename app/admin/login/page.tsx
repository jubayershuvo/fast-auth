import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { AdminLoginForm, NoAdminNotice } from "@/components/admin/admin-login-form";
import { SocialAuthButtons } from "@/components/auth/social-auth-buttons";
import { ThemeToggle } from "@/components/ui/theme";
import { getAdminIdentity } from "@/lib/admin-session";
import { listEnabledProviders } from "@/lib/oauth-config";
import { connectToDatabase } from "@/lib/mongodb";
import { AdminUserModel } from "@/models/AdminUser";

export const metadata: Metadata = {
  title: "Administrator sign in",
  // Operator back-office: never index or cache.
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage() {
  // Already signed in? Skip straight to the panel.
  if (await getAdminIdentity()) {
    redirect("/admin");
  }

  // Tell the operator how to bootstrap if no admin exists yet.
  await connectToDatabase();
  const adminCount = await AdminUserModel.estimatedDocumentCount();
  const providers = await listEnabledProviders("admin");

  return (
    <div className="relative flex min-h-screen items-center justify-center px-6">
      {/*
        The theme control is a client component, so it is placed here in a
        server-rendered page rather than making the whole page one.
      */}
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-[400px]">
        <div className="mb-7 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-danger-500/15">
            <ShieldCheck className="h-5 w-5 text-danger-400" />
          </span>
          <div>
            <p className="text-[15px] font-semibold tracking-tight">FastAuth</p>
            <p className="text-[11px] uppercase tracking-wider text-ink-subtle">
              Operator console
            </p>
          </div>
        </div>

        <div className="card p-6">
          <h1 className="text-lg font-semibold tracking-tight">Administrator sign in</h1>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            Restricted to platform operators. All access is logged.
          </p>

          <div className="mt-5 space-y-6">
            {adminCount === 0 ? (
              <div className="space-y-4">
                <NoAdminNotice />
                <AdminLoginForm />
              </div>
            ) : (
              <>
                <AdminLoginForm />
                {providers.length > 0 ? (
                  <SocialAuthButtons
                    providers={providers}
                    realm="admin"
                    action="Sign in"
                  />
                ) : null}
              </>
            )}
          </div>
        </div>

        <p className="mt-5 text-center text-[12px] text-ink-subtle">
          <Link href="/login" className="hover:text-ink">
            ← Back to customer sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
