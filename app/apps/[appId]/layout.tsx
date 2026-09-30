import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import Link from "next/link";
import { KeyRound } from "lucide-react";

import { findApplicationByAppId } from "@/lib/application";
import { ToastProvider } from "@/components/ui/toast";
import { ThemeToggle } from "@/components/ui/theme";

/**
 * One application's portal, addressed as `/apps/<appId>/…`.
 *
 * Why the application is in the URL rather than a form field: an end-user
 * username is only unique WITHIN an application, so there is nothing to sign in
 * to until the application is known. Putting it in the path removes a field the
 * person would otherwise have to copy out of an email, and gives every
 * application its own sign-in URL that can be linked from a game launcher or an
 * email footer. The dashboard customers keep `/login` and `/dashboard`, which
 * are a different realm with a different cookie entirely.
 *
 * The layout resolves the application ONCE and 404s on an unknown `appId`, so
 * both children can rely on it. It deliberately does NOT decide who is signed
 * in: the login page must render for exactly the people the dashboard must
 * refuse.
 */
export default async function AppPortalLayout({
  children,
  params,
}: {
  children: ReactNode;
  /**
   * Typed `Promise<unknown>` on purpose. Next's generated `LayoutProps` for this
   * route declares exactly that, and a narrower `{ appId: string }` here makes
   * the layout unassignable to it. Narrowing happens at runtime below, which is
   * the honest place for it anyway: a path parameter is user-controlled input.
   */
  params: Promise<unknown>;
}) {
  const { appId } = (await params) as { appId?: unknown };
  const appIdString = typeof appId === "string" ? appId : "";

  // A malformed id never reaches Mongo, and an unknown one is a 404 — the same
  // answer as a deleted application, so neither can be probed for existence.
  const application =
    /^[A-Za-z0-9_-]{3,64}$/.test(appIdString)
      ? await findApplicationByAppId(appIdString)
      : null;
  if (!application) notFound();

  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col bg-surface-950">
        <header className="border-b border-line">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6 sm:py-4">
            <Link
              href={`/apps/${encodeURIComponent(application.appId)}/dashboard`}
              className="flex min-w-0 items-center gap-2.5"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600">
                <KeyRound className="h-4 w-4 text-white" />
              </span>
              <span className="min-w-0">
                {/* The application's own name, so the sign-in screen a person
                    lands on says whose account they are about to use. `truncate`
                    keeps a long name from pushing the header wider than the
                    viewport on a phone. */}
                <span className="block truncate text-[14px] font-semibold tracking-tight">
                  {application.name}
                </span>
                <span className="block truncate text-[11px] text-ink-subtle">
                  Account
                </span>
              </span>
            </Link>
            <ThemeToggle />
          </div>
        </header>

        {/*
          One centred column for the whole portal.

          The flex COLUMN is what lets a short page centre itself vertically: a
          child opts in with `my-auto`, which the sign-in card does and the
          dashboard deliberately does not — a long account page has to start at
          the top, not float in the middle of a tall viewport. Padding steps up
          at `sm` rather than jumping, and every child is `w-full` inside the
          column, so a 320px phone and a wide monitor share one layout.
        */}
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-10">
          {children}
        </main>

        <footer className="border-t border-line">
          <p className="mx-auto w-full max-w-3xl px-4 py-3.5 text-[12px] text-ink-subtle sm:px-6 sm:py-4">
            Powered by FastAuth
          </p>
        </footer>
      </div>
    </ToastProvider>
  );
}