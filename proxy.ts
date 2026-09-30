import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 Proxy (formerly `middleware.ts`).
 *
 * IMPORTANT — this is an OPTIMISTIC check only.
 * It verifies that a session cookie is *present* and bounces anonymous users
 * to /login before a dashboard page is ever rendered. It deliberately does NOT
 * hit the database, because Proxy runs on every matched request and a DB round
 * trip there would add latency to all navigation.
 *
 * The authoritative check lives in the data-access layer
 * (`requireDashboardUser` -> `getSessionUser`), which validates the cookie
 * against MongoDB on every request, including in each API route. A forged or
 * stale cookie therefore cannot read a single protected resource, even if it
 * gets past this file.
 */

const SESSION_COOKIE = "fa_session";
const ADMIN_SESSION_COOKIE = "fa_admin_session";
/** The application's own end user, signed in from a browser. */
const PORTAL_COOKIE = "fa_app_session";

/**
 * Portal API routes reachable with no portal session.
 *
 * Only sign-in: every other route reads or changes the account and must carry
 * the cookie. `/api/portal/auth/logout` is deliberately NOT here — it is
 * idempotent and harmless without a session, and it belongs with the protected
 * routes so the set cannot quietly grow.
 */
const PORTAL_PUBLIC_API = ["/api/portal/auth/login"];

/**
 * Application portal PAGES: `/apps/<appId>/login` and `/apps/<appId>/…`.
 *
 * The application is in the path, which is what lets the sign-in screen ask for
 * a username and a password alone — there is nothing to disambiguate without
 * knowing the application, and a person should never have to copy an id out of
 * an email to prove who they are.
 *
 * A completely separate namespace from the other realms, using its own cookie.
 * It is handled BEFORE the customer logic for exactly that reason: `/apps` paths
 * are not customer pages, so falling through would send an end user to
 * `/login` — a form whose credentials could never authenticate them.
 */
function isPortalPath(pathname: string): boolean {
  return (
    pathname === "/apps" ||
    pathname.startsWith("/apps/") ||
    pathname === "/api/portal" ||
    pathname.startsWith("/api/portal/")
  );
}

/**
 * The only portal pages reachable signed out: this application's sign-in.
 *
 * A REGEX, not a fixed set, because the path now carries an id: there is one
 * sign-in URL per application, and enumerating them here would mean adding a
 * route to the Proxy every time an application is created.
 */
function isPortalEntryPoint(pathname: string): boolean {
  return (
    /^\/apps\/[^/]+\/login$/.test(pathname) ||
    PORTAL_PUBLIC_API.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    )
  );
}

/** The sign-in URL for an application, used when a session is missing. */
function portalLoginUrl(pathname: string): string {
  const appId = pathname.split("/")[2];
  return appId ? `/apps/${encodeURIComponent(appId)}/login` : "/login";
}

/**
 * Routes reachable with no session at all.
 *
 * `/set-password` and `/forgot-password` MUST be here, and their absence would be
 * a lockout, not a cosmetic gap. The user reaching either has no usable password
 * — that is the only reason they are on these screens — so they are by
 * definition signed out. The API endpoints below are already public for exactly
 * that reason, but the PAGES were not listed, so the Proxy bounced them to
 * /login, and /login bounced them straight back: an unbreakable redirect loop
 * for precisely the accounts that need the flow. Neither page issues a cookie.
 */
const PUBLIC_PAGES = new Set([
  "/",
  "/login",
  "/register",
  "/set-password",
  "/forgot-password",
]);

/**
 * API routes that authenticate with their OWN credentials rather than the
 * dashboard cookie:
 *  - /api/auth/login|register establish the customer cookie.
 *  - /api/v1/* is the customer's public API, authenticated by a Bearer token
 *    in the handler. A cookie check here would be meaningless and would
 *    wrongly reject every legitimate game client.
 *  - /api/admin/auth/login establishes the admin cookie.
 *
 * NOTE: prefixes must NOT end in "/", otherwise the boundary test below would
 * look for a double slash and never match.
 */
const PUBLIC_API_PREFIXES = [
  "/api/auth/login",
  "/api/auth/register",
  // Account lifecycle that issues NO cookie and creates no session: email
  // verification and claiming a password. Each still proves control of a
  // mailbox via a one-time code, and each must stay reachable while signed out
  // — a user who cannot verify their address is locked out of the very screen
  // that would tell them why.
  "/api/auth/verify-email",
  "/api/auth/resend-verification",
  "/api/auth/set-password",
  // Password recovery. Same reasoning as the three above, and the same
  // requirement: a person who has forgotten their password is, by definition,
  // signed out, so this has to stay reachable while signed out. It also issues
  // no cookie until the code is confirmed.
  "/api/auth/forgot-password",
  "/api/v1",
  // The machine realm. These authenticate with an `X-Api-Key` header inside the
  // handler, never with a cookie, so a cookie check here would reject every
  // legitimate server-to-server client. This is also why the prefix must stay
  // narrow: anything added under /api/keys inherits "no cookie required", and
  // the handler is the only thing standing between an anonymous caller and the
  // data. Every route in that tree starts with requireApiKey /
  // requireKeyedApplication / requirePlatformApiKey.
  "/api/keys",
  // OAuth start/callback authenticate via the PKCE state cookie and the
  // provider's authorization code, not the dashboard session. The handler
  // performs the real authorisation checks.
  "/api/auth/oauth",
  // Liveness/readiness probe. A load balancer, Kubernetes probe or uptime
  // monitor holds no cookie, so a probe behind the dashboard check is a probe
  // that reports "down" for every deployment that is actually healthy — and
  // during exactly the incidents it exists to detect.
  "/api/health",
];

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Everything owned by the operator console — BOTH the pages under /admin and
 * their JSON endpoints under /api/admin.
 *
 * Both namespaces must be covered here. Matching only "/admin" would let
 * /api/admin/* fall through to the CUSTOMER cookie check below and return a
 * 401 to a perfectly valid admin session.
 */
function isAdminPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api/admin" ||
    pathname.startsWith("/api/admin/")
  );
}

/**
 * Admin endpoints reachable WITHOUT an existing admin cookie.
 *
 * The sign-in screen and the OAuth entry points must be reachable by an
 * anonymous visitor — otherwise nobody could ever log in. They are safe
 * because the handlers do the real authorisation: `/auth/login` verifies
 * credentials, while the OAuth `start`/`callback` pair is gated by the
 * operator-configured provider flags and, crucially, by the rule that an
 * admin OAuth identity must already match a pre-provisioned account.
 */
function isAdminEntryPoint(pathname: string): boolean {
  if (pathname === "/admin/login" || pathname === "/api/admin/auth/login") return true;
  // /api/admin/oauth/<google|github|azure>/<start|callback>
  return /^\/api\/admin\/oauth\/(google|github|azure)\/(start|callback)$/.test(pathname);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Application end-user portal ─────────────────────────────────────────
  // Ahead of everything: it has its own cookie and its own sign-in screen, and
  // must never be redirected to the customer's or the operator's login.
  if (isPortalPath(pathname)) {
    if (isPortalEntryPoint(pathname)) {
      // No redirect here even when signed in. Whether a session belongs to THIS
      // application is a question only the page can answer — it must resolve
      // the session against the app in the path — and a Proxy-level redirect
      // would be guessing. An already-signed-in visitor simply gets the page,
      // which redirects them on if the session is theirs, or shows the form if
      // it belongs to a different application.
      return NextResponse.next();
    }

    if (request.cookies.get(PORTAL_COOKIE)?.value) {
      return NextResponse.next();
    }
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { success: false, error: "UNAUTHORIZED", message: "Sign in to continue." },
        { status: 401 },
      );
    }
    // Back to THIS application's sign-in page, so the person lands somewhere
    // they can actually authenticate.
    return NextResponse.redirect(new URL(portalLoginUrl(pathname), request.url));
  }

  // ── Operator back-office ────────────────────────────────────────────────
  // Handled before the customer logic, because the two use different cookies
  // and must never be interchangeable.
  if (isAdminEntryPoint(pathname)) {
    if (pathname === "/admin/login" && request.cookies.get(ADMIN_SESSION_COOKIE)?.value) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    return NextResponse.next();
  }

  if (isAdminPath(pathname)) {
    if (request.cookies.get(ADMIN_SESSION_COOKIE)?.value) {
      return NextResponse.next();
    }
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { success: false, error: "UNAUTHORIZED", message: "Administrator sign-in required." },
        { status: 401 },
      );
    }
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  if (PUBLIC_PAGES.has(pathname)) {
    // Already signed in? Skip the login/register screens.
    if (request.cookies.get(SESSION_COOKIE)?.value) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  // The public v1 API and the auth endpoints manage their own credentials.
  if (isPublicApi(pathname)) {
    return NextResponse.next();
  }

  // Documentation is public to everyone, and must NOT be redirected when a
  // visitor is already signed in (unlike /login) — otherwise a customer could
  // never read the docs from their browser.
  if (pathname === "/docs" || pathname.startsWith("/docs/")) {
    return NextResponse.next();
  }

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    // Dashboard APIs answer with JSON, never a redirect.
    return NextResponse.json(
      { success: false, error: "UNAUTHORIZED", message: "Authentication required." },
      { status: 401 },
    );
  }

  const loginUrl = new URL("/login", request.url);
  // Preserve the destination so login can bounce the user back.
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals and static assets.
     * API routes ARE included so unauthenticated JSON callers get a 401
     * rather than a redirect to an HTML page.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
