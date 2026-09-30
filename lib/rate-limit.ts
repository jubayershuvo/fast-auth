import "server-only";

/**
 * In-memory fixed-window rate limiter.
 *
 * SCOPE / LIMITATION — be explicit about this: state lives in the Node
 * process, so limits are per-instance. On a single instance (or a sticky
 * deployment) it is correct; behind a multi-instance load balancer each
 * instance enforces its own window, so the effective limit multiplies by the
 * instance count. For multi-instance production, swap the two functions in
 * this file for a Redis `INCR` + `EXPIRE` implementation that keeps the exact
 * same call signature — nothing else in the app needs to change.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Bound memory: without this the map grows with every unique attacker-supplied
// key until the process runs out of heap.
const MAX_BUCKETS = 10_000;
let lastSweep = Date.now();

function sweep(now: number): void {
  // Cheap periodic cleanup of expired buckets (at most once a minute).
  if (now - lastSweep < 60_000 && buckets.size < MAX_BUCKETS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Hard cap: if still oversized, drop the oldest half.
  if (buckets.size >= MAX_BUCKETS) {
    const entries = [...buckets.entries()].sort(
      (a, b) => a[1].resetAt - b[1].resetAt,
    );
    for (const [key] of entries.slice(0, Math.floor(MAX_BUCKETS / 2))) {
      buckets.delete(key);
    }
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets — surfaced as the Retry-After header. */
  retryAfterSeconds: number;
};

/**
 * Read the current state without consuming quota.
 *
 * `limit` is needed to report `remaining`; the window length is not, because
 * the bucket itself already carries its own reset time.
 */
export function checkRateLimit(key: string, limit: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  return {
    allowed: bucket.count < limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds,
  };
}

/** Consume one unit of quota. Call after `checkRateLimit` allows. */
export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return {
      // A brand-new bucket has consumed 1 of `limit`. Reporting `allowed: true`
      // unconditionally was wrong for limit <= 1 — it claimed quota remained
      // after the one request the limiter allows had already been spent.
      allowed: 1 <= limit,
      remaining: Math.max(0, limit - 1),
      retryAfterSeconds: 0,
    };
  }

  existing.count += 1;
  return {
    allowed: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/** Clear a bucket after a successful login so good users aren't punished. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}
