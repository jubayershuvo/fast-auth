import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Keep these out of the server bundle. `bcryptjs` is pure JS but is a
   * server-only, CPU-bound dependency; bundling it separately avoids it being
   * traced into client chunks by the module graph. `server-only` is a marker
   * package that throws if `lib/*` server code is ever imported by a
   * Client Component — that is the guardrail for our secrets.
   */
  serverExternalPackages: ["bcryptjs", "mongoose", "mongodb", "nodemailer"],
};

export default nextConfig;
