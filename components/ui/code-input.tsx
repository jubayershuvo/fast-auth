"use client";

import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from "react";

import { cn } from "@/lib/cn";

const LENGTH = 6;

/**
 * A 6-digit code as six single-character boxes.
 *
 * Six separate inputs rather than one masked field, which is the difference
 * between a code a person can read back and one they cannot. Typing a digit
 * advances automatically, backspace steps back, and pasting a whole code fills
 * every box — the three things people actually try, and the three that each
 * need different code.
 *
 * Accessibility: the inputs are REAL inputs, not divs, so the platform's own
 * password-manager and OTP autofill behaviour still works. Only the first box
 * carries a label; the rest are `aria-hidden` to a screen reader's tab order
 * but still focusable, with the group announced as a whole via `role="group"`.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  id = "code",
  label = "Verification code",
  invalid,
  autoFocus,
  disabled,
}: {
  value: string;
  /** Always called with the digits typed so far, 0..6 long. */
  onChange: (value: string) => void;
  /** Fired when the sixth digit lands — used to submit without a second click. */
  onComplete?: (value: string) => void;
  id?: string;
  label?: string;
  invalid?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  // Splitting a stored string into boxes, so a paste into box 3 still lands in
  // the right place instead of being silently truncated by maxLength.
  const digits = value.padEnd(LENGTH, " ").slice(0, LENGTH).split("");

  // Focus the first EMPTY box, so autofill that arrives late lands correctly.
  useEffect(() => {
    const firstEmpty = value.length;
    if (firstEmpty < LENGTH) refs.current[firstEmpty]?.focus();
  }, [value]);

  function focusBox(index: number) {
    refs.current[Math.max(0, Math.min(index, LENGTH - 1))]?.focus();
  }

  function setDigit(index: number, char: string) {
    const next = value.split("");
    // Writing an empty string deletes, which is what backspace on a full box
    // should do; `padEnd` above is only for display.
    next[index] = char;
    const joined = next.join("").slice(0, LENGTH);
    onChange(joined);
    if (char && index < LENGTH - 1) focusBox(index + 1);
    if (joined.length === LENGTH) onComplete?.(joined);
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace") {
      event.preventDefault();
      // Second backspace on a filled box clears it and stays put; only an
      // already-empty box steps back, which is the behaviour people expect
      // from a phone keypad.
      if (digits[index].trim()) setDigit(index, "");
      else if (index > 0) {
        setDigit(index - 1, "");
        focusBox(index - 1);
      }
      return;
    }
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusBox(index - 1);
    }
    if (event.key === "ArrowRight" && index < LENGTH - 1) {
      event.preventDefault();
      focusBox(index + 1);
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, LENGTH);
    if (!pasted) return;
    onChange(pasted);
    if (pasted.length === LENGTH) {
      onComplete?.(pasted);
      focusBox(LENGTH - 1);
    } else {
      focusBox(pasted.length);
    }
  }

  return (
    <div role="group" aria-labelledby={`${id}-label`}>
      <label htmlFor={`${id}-0`} id={`${id}-label`} className="label">
        {label}
      </label>

      <div className="flex gap-1.5 sm:gap-2">
        {digits.map((char, index) => (
          <input
            key={index}
            ref={(node) => {
              refs.current[index] = node;
            }}
            id={`${id}-${index}`}
            // `inputMode` is what puts the numeric keypad on a phone; `type`
            // stays text so `maxLength=1` and the caret behave predictably.
            inputMode="numeric"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            maxLength={1}
            value={char.trim()}
            disabled={disabled}
            autoFocus={autoFocus && index === 0}
            aria-label={`${label}, digit ${index + 1} of ${LENGTH}`}
            aria-invalid={invalid || undefined}
            onChange={(event) => {
              const digit = event.target.value.replace(/\D/g, "").slice(-1);
              setDigit(index, digit);
            }}
            onKeyDown={(event) => onKeyDown(index, event)}
            onPaste={onPaste}
            onFocus={(event) => event.target.select()}
            className={cn(
              "input tnum text-center text-lg",
              "h-12 w-full min-w-0 p-0",
              invalid && "input-error",
            )}
          />
        ))}
      </div>
    </div>
  );
}