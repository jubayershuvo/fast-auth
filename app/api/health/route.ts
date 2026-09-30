import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";

/**
 * GET /api/health  —  liveness and readiness probe.
 *
 * Unauthenticated by necessity: a load balancer, Kubernetes probe or uptime
 * monitor has no credentials here, and a probe that needs auth is a probe that
 * fails during exactly the incidents it exists to detect.
 *
 * Two distinct questions, deliberately answered separately:
 *   liveness  — is the process able to serve at all?
 *   readiness — can it reach its dependency (Mongo)?
 *
 * Collapsing them into one number is the common mistake: if a database blip
 * marks the process NOT live, the orchestrator restarts every healthy replica,
 * turning a brief dependency outage into a full outage. So a DB failure yields
 * 503 (unready — take me out of the pool) while the process stays live.
 *
 * Deliberately leaks nothing: no version, no hostnames, no error text. This
 * endpoint is public, so its error messages are attacker-facing.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const startedAt = Date.now();
  let database: "up" | "down" = "up";

  try {
    await connectToDatabase();
  } catch {
    database = "down";
  }

  const ready = database === "up";

  return NextResponse.json(
    {
      success: ready,
      data: {
        // Live regardless of Mongo: the process can still serve and recover.
        status: "ok",
        checks: { database },
        uptimeSeconds: Math.floor(process.uptime()),
        responseTimeMs: Date.now() - startedAt,
      },
    },
    {
      status: ready ? 200 : 503,
      // Caching a probe result is always wrong: a stale "ok" defeats the point.
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}
