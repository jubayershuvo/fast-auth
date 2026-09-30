"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Boxes,
  Fingerprint,
  KeyRound,
  ScrollText,
  ShieldCheck,
  Timer,
} from "lucide-react";

import { ThemeToggle } from "@/components/ui/theme";

const FEATURES = [
  {
    icon: Boxes,
    title: "Isolated tenants",
    body: "Every application is a hard boundary. Users, devices, sessions and logs never cross between them.",
  },
  {
    icon: Timer,
    title: "Real expirations",
    body: "Absolute expiry dates, not day counters. Extend from today or from the previous expiry date.",
  },
  {
    icon: Fingerprint,
    title: "Device limits",
    body: "Cap how many devices a licence may activate, and reset them instantly when a customer buys new hardware.",
  },
  {
    icon: ScrollText,
    title: "Full audit trail",
    body: "Every login, ban, revoke and failure recorded with time, IP and device for the support team.",
  },
];

/** Marketing landing page. Public, statically rendered. */
export function LandingPage() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <div className="absolute inset-0 bg-grid" aria-hidden />
      <div className="absolute inset-0 bg-glow" aria-hidden />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600">
            <KeyRound className="h-5 w-5 text-white" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">FastAuth</span>
        </div>
        <nav className="flex items-center gap-2">
          {/*
            Hidden below `sm`: at phone widths the three nav labels already fill
            the row, and a wrapping header pushes the hero down a screen.
          */}
          <div className="hidden sm:block">
            <Link href="/docs" className="btn btn-sm btn-ghost">
              <BookOpen className="h-3.5 w-3.5" />
              API docs
            </Link>
          </div>
          <Link href="/login" className="btn btn-sm btn-ghost">
            Sign in
          </Link>
          <Link href="/register" className="btn btn-sm btn-primary">
            Get started
          </Link>
          <ThemeToggle />
        </nav>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 py-16">
        <div className="max-w-2xl">
          <span className="badge border border-brand-500/30 bg-brand-500/10 text-brand-300">
            <ShieldCheck className="h-3 w-3" />
            Multi-tenant auth platform
          </span>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            Authentication and licensing,
            <br />
            <span className="text-ink-muted">handled for you.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink-muted">
            Create an application, issue credentials, and control access with
            expirations, bans, device limits and revocable sessions — through a
            single REST API.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/register" className="btn btn-md btn-primary">
              Create your account
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/login" className="btn btn-md btn-secondary">
              Sign in
            </Link>
            <Link
              href="/docs"
              className="btn btn-md btn-ghost"
            >
              <BookOpen className="h-4 w-4" />
              Read the API docs
            </Link>
          </div>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="card p-5">
              <feature.icon className="h-5 w-5 text-brand-400" />
              <h3 className="mt-3 text-[15px] font-semibold">{feature.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                {feature.body}
              </p>
            </div>
          ))}
        </div>
      </main>

      <footer className="relative z-10 border-t border-line px-6 py-6 text-center text-xs text-ink-subtle">
        © {new Date().getFullYear()} FastAuth. All rights reserved.
      </footer>
    </div>
  );
}
