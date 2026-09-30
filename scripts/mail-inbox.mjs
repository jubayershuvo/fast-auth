/**
 * The verification suite's inbox.
 *
 * There is no real mail server in CI, so the server is started with
 * `MAIL_OUTBOX_FILE` pointing at MAIL_OUTBOX below. `lib/mailer.ts` appends every
 * message it "sends" there as JSON, and this module reads it back.
 *
 * This replaces what would otherwise be an HTTP endpoint that returns a live
 * verification code — which is exactly the sort of thing that must never exist
 * in production, even behind a flag. A file on the test machine leaks nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Absolute path, so the server process (a different cwd) can write to it. */
export const MAIL_OUTBOX = fileURLToPath(
  new URL("../.mail-outbox.jsonl", import.meta.url),
);

/** Every message sent so far, oldest first. */
export function readOutbox() {
  if (!existsSync(MAIL_OUTBOX)) return [];
  return readFileSync(MAIL_OUTBOX, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

/**
 * The 6-digit code most recently emailed to `email`.
 *
 * Returns null when nothing was sent, so a caller that asserts on it fails with
 * a clear "no code" rather than silently comparing against `undefined`.
 */
export function lastCodeFor(email) {
  const messages = readOutbox().filter((m) => m.to === email.toLowerCase());
  const last = messages[messages.length - 1];
  if (!last) return null;
  // The body is deliberately the single source: the code is the only indented
  // 6-digit line the mailer writes.
  const match = /\n\s+(\d{6})\n/.exec(last.text);
  return match ? match[1] : null;
}