import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound, ShieldCheck } from "lucide-react";

import { getSessionUser } from "@/lib/session";
import { ThemeToggle } from "@/components/ui/theme";

export const metadata: Metadata = {
  title: "Sign in",
};

/**
 * (auth) route group — split-screen marketing panel + centred form.
 * Already-authenticated visitors are redirected straight to the dashboard.
 */
export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const user = await getSessionUser();
  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Brand panel — hidden on small screens to keep the form focused. */}
      <aside className="relative hidden w-[46%] shrink-0 overflow-hidden border-r border-line bg-surface-950 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-0 bg-grid" aria-hidden />
        <div className="absolute inset-0 bg-glow" aria-hidden />

        <Link href="/" className="relative flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600">
            <KeyRound className="h-5 w-5 text-white" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">FastAuth</span>
        </Link>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Ship authentication once.
            <br />
            <span className="text-ink-muted">Licence the rest.</span>
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-muted">
            Multi-tenant auth infrastructure for your games and software.
            Create an application, issue credentials, and control access with
            expirations, bans, device limits and per-user sessions.
          </p>

          <ul className="mt-8 space-y-3 text-sm text-ink-muted">
            {[
              "Isolated tenants — your users never leak across apps",
              "Device limits, expirations and instant bans",
              "Full audit log of every authentication event",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-ink-subtle">
          © {new Date().getFullYear()} FastAuth. All rights reserved.
        </p>
      </aside>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px]">
          <Link href="/" className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600">
              <KeyRound className="h-5 w-5 text-white" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">FastAuth</span>
          </Link>
          {children}
        </div>
      </main>

      {/* Pinned to the viewport corner, clear of the form. `pointer-events-none`
          on the wrapper keeps it from swallowing clicks on the card behind it —
          only the control itself is interactive. */}
      <div className="pointer-events-none fixed right-4 top-4 z-10 sm:right-6 sm:top-6">
        <div className="pointer-events-auto">
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
