import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="card w-full max-w-md p-8 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-800">
          <FileQuestion className="h-5 w-5 text-ink-subtle" />
        </span>
        <h1 className="mt-4 text-base font-semibold text-ink">Page not found</h1>
        <p className="mt-1.5 text-[13px] text-ink-muted">
          The page you are looking for does not exist, or you do not have access to it.
        </p>
        <Link href="/dashboard" className="btn btn-md btn-primary mt-5">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
