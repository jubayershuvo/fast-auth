"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { cn } from "@/lib/cn";

/** The three choices offered. `system` is the default and the initial state. */
export type ThemeChoice = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "fastauth-theme";

type ThemeContextValue = {
  /** What the visitor picked, which may be `system`. */
  choice: ThemeChoice;
  /** What is actually on screen right now, with `system` resolved. */
  resolved: "light" | "dark";
  setTheme: (choice: ThemeChoice) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/*
  The DOM is the store.

  The live theme lives on <html>, not in React state, because it has to be
  readable by the CSS and by the pre-paint script — and it must survive a
  re-render that has no business knowing about it. `useSyncExternalStore` is
  the right hook for that: it subscribes to an external source, tears down and
  rebuilds correctly under concurrent rendering, and — unlike reading the
  attribute in an effect and calling setState — it does not cause a second
  render pass to discover what was already true on the first.
*/

const listeners = new Set<() => void>();
let mediaQuery: MediaQueryList | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // Created lazily and only in the browser: `matchMedia` does not exist during
  // SSR, and the server snapshot below is what renders there.
  if (!mediaQuery && typeof window !== "undefined") {
    mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    // Fires when the OS switches theme at sunset, and when we set the
    // attribute ourselves, so one listener covers both.
    mediaQuery.addEventListener("change", notify);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && mediaQuery) {
      mediaQuery.removeEventListener("change", notify);
      mediaQuery = null;
    }
  };
}

function notify() {
  for (const listener of listeners) listener();
}

/** What the visitor explicitly chose, or `system` when they have not. */
function readChoice(): ThemeChoice {
  if (typeof document === "undefined") return "system";
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" || attr === "dark" ? attr : "system";
}

/** The theme actually in effect, with `system` resolved against the OS. */
function readResolved(): "light" | "dark" {
  if (typeof document === "undefined") return "dark";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

/** The value to render on the server, before any preference is known. */
const SERVER_CHOICE: ThemeChoice = "system";
const SERVER_RESOLVED: "light" | "dark" = "dark";

export function ThemeProvider({ children }: { children: ReactNode }) {
  // The pre-paint script has already applied the saved theme, so these read
  // correctly on the very first client render.
  const choice = useSyncExternalStore(subscribe, readChoice, () => SERVER_CHOICE);
  const resolved = useSyncExternalStore(
    subscribe,
    readResolved,
    () => SERVER_RESOLVED,
  );

  // Kept in sync for the browser's own UI: form controls, scrollbars and the
  // canvas behind the page are all drawn by `color-scheme`.
  useEffect(() => {
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  const setTheme = useCallback((next: ThemeChoice) => {
    const root = document.documentElement;
    if (next === "system") {
      // Removing the attribute hands control back to the `prefers-color-scheme`
      // block in the stylesheet, which is why no value is written here.
      root.removeAttribute("data-theme");
      try {
        localStorage.removeItem(THEME_STORAGE_KEY);
      } catch {
        /* Storage unavailable — the theme still applies for this page view. */
      }
    } else {
      root.setAttribute("data-theme", next);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        /* As above. */
      }
    }
    // The attribute is the store; tell subscribers to re-read it.
    notify();
  }, []);

  return (
    <ThemeContext.Provider value={{ choice, resolved, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/**
 * The light/dark control.
 *
 * A three-way segmented group rather than a single swap button, because
 * "follow my system" is a real third state and not the same as either colour:
 * a two-way toggle cannot express it, and would have to guess what to do when
 * the OS flips at sunset.
 *
 * `role="radio"` rather than plain buttons so the checked state is announced,
 * and each option is separately labelled — an icon alone tells a screen-reader
 * user nothing about which theme is active.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const ctx = useContext(ThemeContext);
  const choice = ctx?.choice ?? "system";
  const resolved = ctx?.resolved ?? "dark";
  const setTheme = ctx?.setTheme;

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-800 p-0.5",
        className,
      )}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = choice === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={`${label} theme`}
            onClick={() => setTheme?.(value)}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
              active
                ? "bg-surface-900 text-ink shadow-sm"
                : "text-ink-subtle hover:text-ink",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {/* The icon is decorative; the label carries the meaning. On
                "System" the suffix names the theme actually in effect, which
                the icon alone cannot convey. */}
            <span className="sr-only">
              {label}
              {value === "system" ? ` (currently ${resolved})` : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}
