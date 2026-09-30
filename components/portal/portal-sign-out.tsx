"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { apiFetch } from "@/lib/api-client";
import { Spinner } from "@/components/ui/alert";

/**
 * Sign out of the portal.
 *
 * Uses `window.location.assign` rather than a router push, for the same reason
 * the admin shell does: it must DISCARD the client router cache, or the previous
 * user's dashboard stays in memory behind the redirect.
 */
export function PortalSignOut({ appId }: { appId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onSignOut() {
    setPending(true);
    try {
      await apiFetch("/api/portal/auth/logout", { method: "POST" });
    } finally {
      // Back to THIS application's sign-in page — not a generic one, because
      // the next person to use this browser is signing in to the same app.
      // `window.location.assign` rather than a router push: it must DISCARD the
      // client router cache, or the previous user's dashboard stays in memory
      // behind the redirect.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate: must discard the client router cache
      window.location.assign(`/apps/${encodeURIComponent(appId)}/login`);
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={onSignOut}
      disabled={pending}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-850 hover:text-ink disabled:opacity-50"
    >
      {pending ? <Spinner /> : <LogOut className="h-4 w-4 text-ink-subtle" />}
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}