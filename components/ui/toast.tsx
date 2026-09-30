"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";

type ToastTone = "success" | "error" | "warning" | "info";

type Toast = {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
};

type ToastContextValue = {
  toast: (input: { tone: ToastTone; title: string; description?: string }) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, { icon: typeof Info; ring: string }> = {
  success: { icon: CheckCircle2, ring: "border-success-500/40 bg-success-900/60" },
  error: { icon: XCircle, ring: "border-danger-500/40 bg-danger-900/60" },
  warning: { icon: AlertTriangle, ring: "border-warn-500/40 bg-warn-900/60" },
  info: { icon: Info, ring: "border-info-500/40 bg-info-900/60" },
};

const ICON_COLOR: Record<ToastTone, string> = {
  success: "text-success-400",
  error: "text-danger-400",
  warning: "text-warn-400",
  info: "text-info-400",
};

/**
 * Lightweight toast system (no external UI library).
 * `toast()` is safe to call from any client component.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback<ToastContextValue["toast"]>(
    ({ tone, title, description }) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, tone, title, description }]);
      setTimeout(() => dismiss(id), 4500);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
      >
        {toasts.map((item) => {
          const { icon: Icon, ring } = TONE_STYLES[item.tone];
          return (
            <div
              key={item.id}
              role="status"
              className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-xl backdrop-blur ${ring}`}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ICON_COLOR[item.tone]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{item.title}</p>
                {item.description ? (
                  <p className="mt-0.5 text-[12px] text-ink-muted">{item.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss"
                className="shrink-0 text-ink-subtle transition-colors hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/** Access the toast helper. Throws if used outside the provider. */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside a <ToastProvider>.");
  }
  return context;
}
