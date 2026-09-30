import "server-only";

import { appendFile } from "node:fs/promises";

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

import { env } from "@/lib/env";
import type { SmtpTransport } from "@/lib/auth-method";

/**
 * Outbound email, via Nodemailer.
 *
 * WHY A REAL DEPENDENCY: a verification code is only as trustworthy as the
 * channel it arrives on, and hand-rolling SMTP gets TLS, STARTTLS negotiation
 * and authentication wrong in ways that leak credentials. Nodemailer is the
 * well-trodden path and is configured, never guessed.
 *
 * THREE MODES, chosen automatically:
 *  1. SMTP           — when SMTP_HOST is set. Real delivery.
 *  2. Console        — no SMTP_HOST (local dev). The code is PRINTED, not sent.
 *  3. Outbox file    — when MAIL_OUTBOX_FILE is set, every message is also
 *                      appended as JSON. This is how `npm run verify` reads a
 *                      code without a mail account and WITHOUT an HTTP endpoint
 *                      that could leak one in production.
 *
 * A send failure never throws into the request: a user who cannot be emailed a
 * code should get a clean "try again" envelope, not a 500 that might leak SMTP
 * hostnames or credentials. Failures are reported to the server console.
 */

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
};

/** Built once per process; nodemailer pools its own sockets. */
let transport: Transporter | null = null;
/** Which host the cached transport points at, so a panel change rebuilds it. */
let transportHost: string | null = null;

/**
 * The transport to use, resolved by the caller before each send.
 *
 * Set from `getSmtpTransport()`, which reads the operator's panel settings and
 * falls back to the environment. Kept module-level rather than passed in so the
 * transport cache above can key on it.
 *
 * DECLARED BEFORE `getTransport()` ON PURPOSE. It is read by that function, and
 * a `let` binding is in its temporal dead zone until the declaration executes —
 * so had this stayed below `getTransport`, any send that happened during module
 * evaluation would have thrown a ReferenceError instead of using a transport.
 * Declaring state before the code that reads it removes that ordering hazard.
 */
let activeSmtp: SmtpTransport | null = null;

function getTransport(): Transporter {
  // The transport can be REPLACED at runtime by the admin panel, so the cache is
  // keyed on the host. Without this, saving new SMTP credentials in the panel
  // would have no effect until the server was restarted — which looks exactly
  // like the save having failed.
  if (transport && transportHost === activeSmtp?.host) return transport;

  if (activeSmtp) {
    transportHost = activeSmtp.host;
    transport = nodemailer.createTransport({
      host: activeSmtp.host,
      port: activeSmtp.port,
      secure: activeSmtp.secure,
      // Credentials are optional: an internal or open relay accepts any sender.
      ...(activeSmtp.user && activeSmtp.password
        ? { auth: { user: activeSmtp.user, pass: activeSmtp.password } }
        : {}),
    });
  } else {
    // No SMTP configured anywhere. `jsonTransport` accepts the message, encodes
    // it and pretends to send — so every call site behaves identically in dev.
    transportHost = null;
    transport = nodemailer.createTransport({ jsonTransport: true });
  }

  return transport;
}

/**
 * Point the mailer at a transport. Called by the send path.
 *
 * Deliberately NOT named `useTransport`: the React Hooks lint rule treats any
 * `use*` call outside a component or hook as an error, and this is a plain
 * module-level setter with nothing to do with React.
 */
export function setTransport(config: SmtpTransport | null): void {
  activeSmtp = config;
}

/**
 * Deliver one message. Never throws.
 *
 * Returns whether it was handed off, so callers can decide whether to tell the
 * user "check your inbox" or to surface a real failure.
 */
export async function sendMail(message: MailMessage): Promise<boolean> {
  const at = new Date().toISOString();

  // Resolve the operator's panel settings first: they override the environment,
  // and the resolution is cheap (one indexed read) and cached by the transport
  // above. A failure here is NOT fatal — we fall back to the console transport
  // rather than refusing to send.
  try {
    const { getSmtpTransport } = await import("@/lib/auth-method");
    setTransport(await getSmtpTransport());
  } catch (error) {
    console.error("[mailer] Could not resolve the SMTP transport:", error);
  }

  if (!activeSmtp) {
    // Local development / the verification suite. The code is visible in the
    // server console, which is the whole point — there is no inbox here.
    console.log(
      `[mailer] SMTP not configured — message NOT SENT\n` +
        `  to:      ${message.to}\n` +
        `  subject: ${message.subject}\n` +
        `${message.text}`,
    );
  }

  try {
    await getTransport().sendMail({
      // Falls back to a no-reply address derived from the host, so a transport
      // with no explicit `from` still produces a valid, attributable message.
      from: activeSmtp?.from ?? env.mailFrom,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  } catch (error) {
    // Swallowed on purpose: an SMTP outage must not surface a raw driver error
    // (which can contain the host, the username, or the auth exchange) to the
    // person who asked for a code.
    console.error("[mailer] Failed to send message:", error);
    return false;
  }

  if (env.mailOutboxFile) {
    try {
      await appendFile(
        env.mailOutboxFile,
        `${JSON.stringify({ ...message, sentAt: at })}\n`,
        "utf8",
      );
    } catch (error) {
      // Also non-fatal: the message is already away (or deliberately not sent).
      console.error("[mailer] Failed to append to the outbox file:", error);
    }
  }

  return true;
}

/** Body copy for a one-time code. Shared by both code purposes. */
export function codeEmail(options: {
  code: string;
  // Kept in step with `VerificationPurpose`. `reset_password` reads
  // differently on purpose: it replaces a credential the person already had,
  // so the copy warns them that any other sessions are being ended.
  purpose: "verify_email" | "set_password" | "reset_password";
  appName: string;
  minutes: number;
}): string {
  const { code, purpose, appName, minutes } = options;
  const intro =
    purpose === "verify_email"
      ? `Confirm your email address to finish creating your ${appName} account.`
      : purpose === "reset_password"
        ? `Use this code to choose a new password for your ${appName} account.`
        : `Use this code to set a password for your ${appName} account.`;

  // Only a reset needs this: it is the one flow that ends existing sessions, and
  // saying so is the difference between someone understanding they have been
  // locked out of their other devices and someone filing a support ticket.
  const sessionNotice =
    purpose === "reset_password"
      ? [
          "",
          "For your safety, signing in on any other device will require the new password.",
        ]
      : [];

  return [
    intro,
    "",
    `    ${code}`,
    "",
    `The code expires in ${minutes} minutes and can only be used once.`,
    ...sessionNotice,
    "",
    "If you did not request this, you can ignore this email — no action is needed.",
  ].join("\n");
}

/**
 * Sent after a password is actually changed.
 *
 * This is a SECURITY notice, not a confirmation. Someone holding a stolen
 * mailbox can reset a password and be signed straight in; the legitimate owner
 * finds out from this message or not at all, so it has to say what happened,
 * when, and what to do — and it must not read like a receipt they asked for.
 */
export function passwordChangedEmail(options: { appName: string }): string {
  const { appName } = options;
  return [
    `Your ${appName} password was just changed.`,
    "",
    `Time: ${new Date().toUTCString()}`,
    "",
    "You are signed in on this device, and every other session has been signed",
    "out. If you did this, no further action is needed.",
    "",
    "If you did NOT do this, reset your password immediately and contact your",
    "administrator. Someone with access to your email account was able to sign in.",
  ].join("\n");
}