import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AppNav } from "@/components/dashboard/app-nav";
import { requireApplicationOwnerPage } from "@/lib/authorization";

/**
 * Application detail layout.
 *
 * `params` is a Promise in Next.js 16 and must be awaited.
 *
 * `requireApplicationOwnerPage` proves the signed-in customer owns this
 * application BEFORE any child page renders, and calls `notFound()` otherwise —
 * so a guessed application id from another tenant is indistinguishable from a
 * non-existent one. Every child page still re-verifies at the data layer.
 */
export default async function ApplicationLayout({
  children,
  params,
}: LayoutProps<"/dashboard/applications/[appId]">) {
  const { appId } = await params;
  const application = await requireApplicationOwnerPage(appId);

  return (
    <div className="mx-auto max-w-6xl px-5 py-7 sm:px-7 lg:px-9">
      <Link
        href="/dashboard/applications"
        className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All applications
      </Link>

      <header className="mt-3 flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {application.name}
        </h1>
        <p className="font-mono text-[12px] text-ink-subtle">{application.appId}</p>
      </header>

      <AppNav appId={application._id.toString()} />

      <div className="mt-6">{children}</div>
    </div>
  );
}
