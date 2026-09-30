/**
 * Shared harness for the end-to-end verification suite.
 *
 * Every phase module imports `check`, `section` and `call` from here, and a
 * `Session` cookie jar so the dashboard login survives between requests.
 */

export const PORT = 4311;
export const BASE = `http://127.0.0.1:${PORT}`;

/**
 * The SESSION_SECRET the suite's server runs with.
 *
 * Exported so a phase that has to produce a credential the SERVER will accept —
 * an API key, which is hashed with this salt exactly as `create-api-key` hashes
 * it against .env.local — uses the identical value. Hard-coding the literal a
 * second time inside a phase would silently diverge the moment this one changed,
 * and every key would 401 for a reason that looks like an auth bug.
 */
export const SESSION_SECRET =
  "test-secret-0123456789abcdef0123456789abcdef0123456789";

let passed = 0;
let failed = 0;
const failures = [];

export function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

export function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

export function tally() {
  return { passed, failed, failures };
}

/**
 * Cookie jar that honours the `Path` attribute, as a browser does.
 *
 * This deliberately implements RFC 6265 §5.1.4 rather than sending every
 * cookie everywhere. A jar that ignores Path will happily authenticate a
 * request the browser would have sent WITHOUT the cookie, which hides exactly
 * the class of bug where a cookie is scoped to "/admin" but the API lives at
 * "/api/admin": the page works, the API 401s, and the whole suite stays green.
 */
export class Session {
  constructor() {
    /** @type {Map<string, {name: string, value: string, path: string}>} */
    this.cookies = new Map();
  }

  absorb(response) {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair, ...attributes] = raw.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();

      // Default per RFC 6265 is the directory of the request path, but every
      // cookie this app sets is explicit, so "/" is a safe floor.
      const pathAttr = attributes
        .map((a) => a.trim())
        .find((a) => a.toLowerCase().startsWith("path="));
      const path = pathAttr ? pathAttr.slice(5).trim() : "/";

      // Keyed by name AND path, as a browser does. This matters: expiring a
      // legacy Path=/admin cookie must NOT evict the live Path=/ cookie of the
      // same name, and name-only keying silently conflates the two.
      const key = `${name}|${path}`;
      if (value === "") this.cookies.delete(key);
      else this.cookies.set(key, { name, value, path });
    }
  }

  /** RFC 6265 §5.1.4 path-match: cookie-path must be a prefix of request-path. */
  matches(cookiePath, requestPath) {
    if (cookiePath === requestPath) return true;
    if (!requestPath.startsWith(cookiePath)) return false;
    return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
  }

  /** Every stored cookie with this name, across all paths. */
  all(name) {
    return [...this.cookies.values()].filter((c) => c.name === name);
  }

  /**
   * Cookies to send for `requestPath`, honouring each cookie's Path.
   *
   * Defaults to "/" — correct for the session cookies (Path=/) used by the
   * page-level checks. Callers driving a path-scoped cookie (the PKCE state
   * cookie at /api/auth/oauth) MUST pass the real request path.
   */
  header(requestPath = "/") {
    const sent = [];
    for (const { name, value, path } of this.cookies.values()) {
      if (this.matches(path, requestPath)) sent.push(`${name}=${value}`);
    }
    return sent.join("; ");
  }
}

/** Issue an HTTP request and parse the standard response envelope. */
export async function call(
  session,
  method,
  path,
  body,
  extraHeaders = {},
  // Extra `fetch` options. Exists for `redirect: "manual"`: by default fetch
  // FOLLOWS a redirect, so a test asserting "this path bounces to sign-in"
  // would silently receive the destination's 200 and prove nothing.
  options = {},
) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session && session.header(path) ? { Cookie: session.header(path) } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    // Spread last so a caller can override `redirect`/`cache` without the
    // fields above having to be repeated.
    ...options,
  });
  session?.absorb(response);
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  // `headers` is returned so a test can assert on `location` — see the
  // `redirect: "manual"` note above. Additive, so no existing caller changes.
  return { status: response.status, headers: response.headers, body: json };
}

/**
 * Register a customer AND complete the email verification, leaving `session`
 * signed in.
 *
 * Registration deliberately does NOT sign anyone in — it emails a 6-digit code
 * and the account stays unusable until that code is entered. Every phase that
 * needs a signed-in customer therefore has to do both halves, and doing it by
 * hand in six files means six chances to forget the second half (which shows up
 * as a confusing 403 much later).
 *
 * `lastCodeFor` reads the code from the mail outbox the server was started
 * with, so this exercises the real send path.
 */
export async function registerAndVerify(session, profile) {
  const created = await call(session, "POST", "/api/auth/register", profile);
  if (created.status !== 201) return created;

  const { lastCodeFor } = await import("./mail-inbox.mjs");
  const code = lastCodeFor(profile.email);
  if (!code) {
    return {
      status: 500,
      body: { error: "NO_CODE_EMAILED", message: "No verification code was sent." },
    };
  }

  return call(session, "POST", "/api/auth/verify-email", {
    email: profile.email,
    code,
  });
}
