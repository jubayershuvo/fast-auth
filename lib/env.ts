import "server-only";

/**
 * Centralised, validated access to environment variables.
 *
 * Rules enforced here:
 *  - Secrets are read ONLY on the server (`server-only` guard).
 *  - Missing/invalid production secrets fail loudly at first use.
 *  - Nothing is ever hard-coded in source.
 */

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`,
    );
  }
  return value;
}

function intVar(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer.`);
  }
  return parsed;
}

function boolVar(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw === "true" || raw === "1";
}

const isProd = process.env.NODE_ENV === "production";

/**
 * `SESSION_SECRET` underpins token hashing salts. In production we refuse to
 * boot with a weak/absent value so a leaked default can never reach prod.
 */
function sessionSecret(): string {
  const secret = required("SESSION_SECRET");
  if (isProd && secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be at least 32 characters in production.",
    );
  }
  if (isProd && secret.includes("replace-with")) {
    throw new Error("SESSION_SECRET is still the example value. Set a real one.");
  }
  return secret;
}

export const env = {
  get mongodbUri(): string {
    return required("MONGODB_URI");
  },
  get sessionSecret(): string {
    return sessionSecret();
  },
  get appName(): string {
    return process.env.NEXT_PUBLIC_APP_NAME ?? "FastAuth";
  },
  get appUrl(): string {
    return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  },
  get isProd(): boolean {
    return isProd;
  },
  /** `secure` must be true in production so cookies only travel over HTTPS. */
  get cookieSecure(): boolean {
    return boolVar("COOKIE_SECURE", isProd);
  },
  get dashboardSessionTtlMs(): number {
    return intVar("DASHBOARD_SESSION_TTL_DAYS", 7) * 24 * 60 * 60 * 1000;
  },
  get adminSessionTtlMs(): number {
    return intVar("ADMIN_SESSION_TTL_HOURS", 8) * 60 * 60 * 1000;
  },
  get appSessionTtlMs(): number {
    return intVar("APP_SESSION_TTL_DAYS", 30) * 24 * 60 * 60 * 1000;
  },
  /**
   * Hard ceiling on how long ONE session may live, regardless of renewals.
   *
   * Renewal slides the window forward, which on its own would let a session
   * live forever: a client that refreshes before every expiry never has to log
   * in again, so a stolen token becomes permanent. Clamping the renewed expiry
   * to `createdAt + this` keeps sliding useful while forcing a real
   * re-authentication at least this often.
   *
   * Must be >= appSessionTtlMs, or renewal would shorten sessions.
   */
  get appSessionMaxLifetimeMs(): number {
    return intVar("APP_SESSION_MAX_LIFETIME_DAYS", 90) * 24 * 60 * 60 * 1000;
  },
  /**
   * Maximum concurrent live sessions per end user.
   *
   * Without a cap, login can be called in a loop to create unlimited session
   * documents — unbounded storage growth and a cheap way to bloat the owner's
   * session list. 0 disables the cap.
   */
  get maxSessionsPerUser(): number {
    return intVar("MAX_SESSIONS_PER_USER", 20);
  },
  get loginRateLimitMax(): number {
    return intVar("LOGIN_RATE_LIMIT_MAX", 10);
  },
  /**
   * Admin sign-in is limited more aggressively than customer sign-in: an
   * admin session can read every tenant's data, so brute-forcing it is the
   * highest-value target on the system.
   */
  get adminLoginRateLimitMax(): number {
    return intVar("ADMIN_LOGIN_RATE_LIMIT_MAX", 5);
  },
  get adminLoginRateLimitWindowMs(): number {
    return intVar("ADMIN_LOGIN_RATE_LIMIT_WINDOW_SECONDS", 900) * 1000;
  },
  get loginRateLimitWindowMs(): number {
    return intVar("LOGIN_RATE_LIMIT_WINDOW_SECONDS", 300) * 1000;
  },
  get dashboardLoginRateLimitMax(): number {
    return intVar("DASHBOARD_LOGIN_RATE_LIMIT_MAX", 10);
  },
  get dashboardLoginRateLimitWindowMs(): number {
    return intVar("DASHBOARD_LOGIN_RATE_LIMIT_WINDOW_SECONDS", 600) * 1000;
  },
  /**
   * Failed `X-Api-Key` presentations per IP.
   *
   * A key is 256 bits of CSPRNG output, so it cannot be brute-forced — but an
   * unauthenticated endpoint that runs a Mongo lookup per request is a free
   * amplification target, and a guessed-key flood should be cheap to refuse.
   * Generous by design: a misconfigured CI job retrying in a loop should not
   * lock out a legitimate integration.
   */
  get apiKeyRateLimitMax(): number {
    return intVar("API_KEY_RATE_LIMIT_MAX", 60);
  },
  get apiKeyRateLimitWindowMs(): number {
    return intVar("API_KEY_RATE_LIMIT_WINDOW_SECONDS", 300) * 1000;
  },

  // --- email (verification + password setup) --------------------------------

  /**
   * SMTP host. When absent, `lib/mailer.ts` falls back to a console transport
   * that PRINTS the code instead of sending it, so local development and the
   * verification suite work with no mail account configured.
   */
  get smtpHost(): string | null {
    const value = process.env.SMTP_HOST;
    return value && value.trim() !== "" ? value.trim() : null;
  },
  get smtpPort(): number {
    return intVar("SMTP_PORT", 587);
  },
  get smtpUser(): string | null {
    return process.env.SMTP_USER?.trim() || null;
  },
  get smtpPass(): string | null {
    return process.env.SMTP_PASS?.trim() || null;
  },
  /** The "From" header. Falls back to a no-reply address on the SMTP host. */
  get mailFrom(): string {
    return process.env.MAIL_FROM?.trim()
      ?? `no-reply@${this.smtpHost ?? "localhost"}`;
  },
  /**
   * Optional file that every sent message is appended to as JSON.
   *
   * This is how `npm run verify` reads verification codes without a real mail
   * server and without adding an HTTP endpoint that could leak a code in
   * production. Unset ⇒ nothing is written.
   */
  get mailOutboxFile(): string | null {
    return process.env.MAIL_OUTBOX_FILE?.trim() || null;
  },
  /**
   * How long an emailed code stays valid.
   *
   * Short by design: it is a one-time credential for a single action, and a
   * long-lived one is a password reset link that never expires.
   */
  get emailCodeTtlMinutes(): number {
    return intVar("EMAIL_CODE_TTL_MINUTES", 15);
  },
  /** Wrong-code attempts allowed before the code is destroyed. */
  get emailCodeMaxAttempts(): number {
    return intVar("EMAIL_CODE_MAX_ATTEMPTS", 5);
  },
  /** Codes a single email address may request per window. */
  get emailCodeRateLimitMax(): number {
    return intVar("EMAIL_CODE_RATE_LIMIT_MAX", 5);
  },
  get emailCodeRateLimitWindowMs(): number {
    return intVar("EMAIL_CODE_RATE_LIMIT_WINDOW_SECONDS", 900) * 1000;
  },

  // --- self-service portal (application end users) ---

  /**
   * How long a device must have been idle before its owner may delete it from
   * the portal.
   *
   * WHY THIS EXISTS: deleting a device frees a licence seat. Without a delay, a
   * user could delete the device they are using RIGHT NOW, kick themselves out
   * mid-session, and — more usefully to an attacker — churn seats to keep an
   * account's device list from filling up. Requiring a quiet period means a
   * device has to have been genuinely idle before it can be removed, which is
   * also exactly when a person actually wants to remove it.
   *
   * 0 disables the rule, which would make deletion unrestricted. The default is
   * 60 minutes.
   */
  get portalDeviceIdleMinutes(): number {
    return intVar("PORTAL_DEVICE_IDLE_MINUTES", 60);
  },
} as const;
