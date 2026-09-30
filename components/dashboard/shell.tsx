"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  X,
} from "lucide-react";

import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { ThemeToggle } from "@/components/ui/theme";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/applications", label: "Applications", icon: Boxes },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
] as const;

function NavLink({
  href,
  label,
  icon: Icon,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  // Exact match for the index, prefix match for nested sections.
  const active =
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        active
          ? "bg-surface-800 font-medium text-ink"
          : "text-ink-muted hover:bg-surface-850 hover:text-ink",
      )}
    >
      <Icon className={cn("h-4 w-4", active ? "text-brand-400" : "text-ink-subtle")} />
      {label}
    </Link>
  );
}

export function Sidebar({ username, email }: { username: string; email: string }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  async function handleLogout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    // A hard navigation is required here, not router.push: signing out
    // invalidates the session cookie, and the client-side RSC router cache
    // would otherwise let a stale dashboard payload render. router.refresh()
    // cannot clear it either, because the layout itself no longer resolves.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate: must discard the client router cache
    window.location.assign("/login");
  }

  const nav = (
    <nav className="flex flex-1 flex-col gap-1">
      {NAV.map((item) => (
        <NavLink key={item.href} {...item} onNavigate={close} />
      ))}
    </nav>
  );

  const identity = (
    <div className="border-t border-line pt-3">
      <div className="mb-2 flex items-center gap-3 px-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600/20 text-[12px] font-semibold uppercase text-brand-300">
          {username.slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink">{username}</p>
          <p className="truncate text-[11px] text-ink-subtle">{email}</p>
        </div>
      </div>
      {/* Theme sits above sign-out: it is a persistent preference, whereas
          signing out ends the session — the two are not the same kind of
          action and should not sit side by side looking alike. */}
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
    <Link href="/dashboard" onClick={close} className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600">
        <KeyRound className="h-5 w-5 text-white" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">FastAuth</span>
    </Link>
  );

  return (
    <>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-surface-950/95 px-4 py-3 backdrop-blur lg:hidden">
        {brand}
        <div className="flex items-center gap-2">
          {/* The sidebar's own copy of this is inside the closed drawer, so the
              top bar needs its own or the control is unreachable on a phone. */}
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

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={close}
            className="absolute inset-0 bg-black/60"
          />
          <aside className="absolute left-0 top-0 flex h-full w-[264px] flex-col gap-6 border-r border-line bg-surface-950 p-4">
            <div className="flex items-center justify-between">
              {brand}
              <button type="button" onClick={close} aria-label="Close" className="btn btn-sm btn-ghost">
                <X className="h-4 w-4" />
              </button>
            </div>
            {nav}
            {identity}
          </aside>
        </div>
      ) : null}

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col gap-6 border-r border-line bg-surface-950 p-4 lg:flex">
        {brand}
        {nav}
        {identity}
      </aside>
    </>
  );
}

export function DashboardShell({
  username,
  email,
  children,
}: {
  username: string;
  email: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar username={username} email={email} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
