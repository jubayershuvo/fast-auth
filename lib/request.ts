import "server-only";

/**
 * Request context helpers (IP + user agent).
 *
 * PRIVACY: the client can spoof `x-forwarded-for` unless a trusted proxy
 * rewrites it. Treat these as best-effort attribution for the audit log, never
 * as an authentication factor.
 */

/** Read the first entry of a comma-separated header. */
function firstHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

/**
 * Resolve the client IP. Prefers platform-provided headers, falling back to
 * platform sockets headers.
 */
export function getClientIp(request: Request): string | null {
  const headers = request.headers;
  return (
    firstHeaderValue(headers.get("cf-connecting-ip")) ??
    firstHeaderValue(headers.get("x-real-ip")) ??
    firstHeaderValue(headers.get("x-forwarded-for")) ??
    null
  );
}

export function getUserAgent(request: Request): string | null {
  const ua = request.headers.get("user-agent");
  return ua ? ua.slice(0, 300) : null;
}

export type RequestContext = {
  ip: string | null;
  userAgent: string | null;
};

export function getRequestContext(request: Request): RequestContext {
  return { ip: getClientIp(request), userAgent: getUserAgent(request) };
}

/**
 * Derive a short, human-friendly device label from a user agent so the device
 * table is scannable. Purely cosmetic.
 */
export function describePlatform(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  if (ua.includes("windows")) return "Windows";
  if (ua.includes("mac os") || ua.includes("macintosh")) return "macOS";
  if (ua.includes("android")) return "Android";
  if (ua.includes("iphone") || ua.includes("ipad")) return "iOS";
  if (ua.includes("linux")) return "Linux";
  return "Unknown";
}
