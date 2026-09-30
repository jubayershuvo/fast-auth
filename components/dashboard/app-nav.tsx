"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fingerprint, KeyRound, ScrollText, Users, Activity } from "lucide-react";

import { cn } from "@/lib/cn";

const TABS = [
  { segment: "", label: "Overview", icon: Activity },
  { segment: "users", label: "Users", icon: Users },
  { segment: "devices", label: "Devices", icon: Fingerprint },
  { segment: "sessions", label: "Sessions", icon: KeyRound },
  { segment: "logs", label: "Logs", icon: ScrollText },
] as const;

export function AppNav({ appId }: { appId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/applications/${appId}`;

  return (
    <nav className="mt-5 -mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((tab) => {
        const href = tab.segment ? `${base}/${tab.segment}` : base;
        const active = tab.segment
          ? pathname.startsWith(href)
          : pathname === href;
        return (
          <Link
            key={tab.label}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-[13px] transition-colors",
              active
                ? "border-brand-500 font-medium text-ink"
                : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
