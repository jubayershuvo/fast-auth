import { Terminal } from "lucide-react";

/**
 * Ready-to-paste cURL snippet showing how to call the public API.
 * Rendered server-side; purely presentational.
 */
export function ApiExample({ appId }: { appId: string }) {
  const snippet = `# 1. Log in an end user — returns a session token
curl -X POST http://localhost:3000/api/v1/auth/login \\
  -H "Content-Type: application/json" \\
  -H "X-App-Id: ${appId}" \\
  -d '{
    "username": "player123",
    "password": "Secret123",
    "deviceId": "device-unique-id"
  }'

# 2. Validate the token on every protected request
curl http://localhost:3000/api/v1/auth/validate \\
  -H "Authorization: Bearer <sessionToken>"`;

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Terminal className="h-4 w-4 text-ink-subtle" />
        <h2 className="text-sm font-semibold text-ink">Quick start</h2>
      </header>
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[12px] leading-relaxed text-ink-muted">
        {snippet}
      </pre>
    </section>
  );
}
