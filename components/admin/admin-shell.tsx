"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Boxes,
  Fingerprint,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  ShieldCheck,
  ToggleLeft,
  Users,
  X,
} from "lucide-react";

import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { ThemeToggle } from "@/components/ui/theme";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/admin/applications", label: "Applications", icon: Boxes },
  { href: "/admin/app-users", label: "App users", icon: KeyRound },
  { href: "/admin/devices", label: "Devices", icon: Fingerprint },
  { href: "/admin/sessions", label: "Sessions", icon: Activity },
  { href: "/admin/logs", label: "Logs", icon: ScrollText },
  // One entry for ALL sign-in configuration. Social providers used to have their
  // own page; they live under this one now, so "how do people sign in here?" has
  // a single answer in a single place.
  { href: "/admin/settings/auth-methods", label: "Sign-in methods", icon: ToggleLeft },
] as const;

/** Operator console chrome. Visually distinct from the customer dashboard. */
export function AdminShell({
  username,
  children,
}: {
  username: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  async function handleLogout() {
    await apiFetch("/api/admin/auth/logout", { method: "POST" });
    // Hard navigation: the admin session row is revoked server-side, so the
    // client-side RSC cache must be discarded or a stale panel would render.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate: must discard the client router cache
    window.location.assign("/admin/login");
  }

  const nav = (
    <nav className="flex flex-1 flex-col gap-1">
      {NAV.map((item) => {
        const active =
          item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-danger-500/10 font-medium text-ink"
                : "text-ink-muted hover:bg-surface-850 hover:text-ink",
            )}
          >
            <item.icon
              className={cn("h-4 w-4", active ? "text-danger-400" : "text-ink-subtle")}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const identity = (
    <div className="border-t border-line pt-3">
      <div className="mb-2 flex items-center gap-3 px-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-danger-500/20 text-[12px] font-semibold uppercase text-danger-400">
          {username.slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink">{username}</p>
          <p className="truncate text-[11px] text-ink-subtle">Platform operator</p>
        </div>
      </div>
      <div className="mb-2 flex justify-center px-2">
        <ThemeToggle />
      </div>
      <button
        type="button"
        onClick={handleLogout}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-850 hover:text-danger-400"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </div>
  );

  const brand = (
    <Link href="/admin" onClick={() => setOpen(false)} className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-danger-500/20">
        <ShieldCheck className="h-5 w-5 text-danger-400" />
      </span>
      <div>
        <p className="text-[15px] font-semibold leading-tight tracking-tight">FastAuth</p>
        <p className="text-[10px] uppercase tracking-wider text-ink-subtle">Admin</p>
      </div>
    </Link>
  );

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-surface-950/95 px-4 py-3 backdrop-blur lg:hidden">
        {brand}
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            className="btn btn-sm btn-ghost"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <aside className="absolute left-0 top-0 flex h-full w-[264px] flex-col gap-6 border-r border-line bg-surface-950 p-4">
            <div className="flex items-center justify-between">
              {brand}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="btn btn-sm btn-ghost"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {nav}
            {identity}
          </aside>
        </div>
      ) : null}

      <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col gap-6 border-r border-line bg-surface-950 p-4 lg:flex">
        {brand}
        {nav}
        {identity}
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
