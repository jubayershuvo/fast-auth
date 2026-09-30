"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * A password field with a show/hide toggle.
 *
 * Built once here rather than hand-rolled in each of the eight forms that ask
 * for a password, because the toggle has three things every copy would get
 * subtly wrong otherwise:
 *
 *   1. The button is `type="button"`. Without it, pressing it SUBMITS the form —
 *      so "let me check what I typed" would sign the person in.
 *   2. The accessible name changes with the state ("Show password" /
 *      "Hide password"), so a screen reader says which way the toggle points
 *      rather than only "button". `aria-pressed` carries the state too.
 *   3. The input keeps its own `autoComplete` and `name`, so password managers
 *      and the browser's own reveal affordances keep working.
 *
 * The right padding is reserved for the icon so the text never runs underneath
 * it. Every other prop passes straight through, so this is a drop-in
 * replacement for a plain `<input type="password">`.
 */
export function PasswordInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? "text" : "password"}
        className={cn("input pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        // `title` as well as the aria-label: it is the native tooltip, and it
        // is what a pointer user gets on hover.
        title={visible ? "Hide password" : "Show password"}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-ink-subtle transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
      >
        {visible ? (
          <EyeOff className="h-4 w-4" aria-hidden />
        ) : (
          <Eye className="h-4 w-4" aria-hidden />
        )}
      </button>
    </div>
  );
}

/**
 * The confirm-password field, always rendered.
 *
 * It used to return null until the first password box had something in it, on
 * the reasoning that an empty confirm box beside an untouched field reads as an
 * error nobody has made yet. In practice that was worse than the problem it
 * solved: the field popped into existence mid-form, which made the screen look
 * broken and made people miss it entirely. A confirm field that is simply
 * always there is the thing every other site does, and it is what makes the
 * form's shape obvious before anyone starts typing.
 *
 * The mismatch warning is still held back until there is something to compare,
 * so the form does not open by shouting at someone who has not typed yet.
 */
export function ConfirmPasswordField({
  value,
  onChange,
  password,
  id = "confirm-password",
  autoComplete = "new-password",
  minLength,
  label = "Confirm password",
  fieldError,
}: {
  value: string;
  onChange: (value: string) => void;
  /** The password being confirmed. */
  password: string;
  id?: string;
  autoComplete?: string;
  minLength?: number;
  label?: string;
  /** Server-side error for this field, shown alongside the mismatch message. */
  fieldError?: string;
}) {
  // Only complain once the person has actually typed something to compare.
  const mismatch = value.length > 0 && value !== password;

  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <PasswordInput
        id={id}
        name="confirmPassword"
        autoComplete={autoComplete}
        required
        minLength={minLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={mismatch || undefined}
        aria-describedby={`${id}-hint`}
        className={mismatch ? "input-error" : undefined}
      />
      <p
        id={`${id}-hint`}
        className={cn(
          "mt-1.5 text-[12px]",
          mismatch ? "text-danger-400" : "text-ink-subtle",
        )}
      >
        {mismatch
          ? "Passwords do not match."
          : "Type it once more so a typo cannot lock you out."}
      </p>
      {fieldError ? (
        <p className="mt-1.5 text-[12px] text-danger-400">{fieldError}</p>
      ) : null}
    </div>
  );
}