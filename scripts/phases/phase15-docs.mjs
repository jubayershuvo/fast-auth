import { spawnSync } from "node:child_process";

import { check, section, call, Session } from "../harness.mjs";

/**
 * Phase 15 — API documentation.
 *
 * The docs are generated from a catalogue, so the risk is not typos but DRIFT:
 * the catalogue describing an endpoint that does not exist, or omitting one
 * that does. This phase hits the running server and compares.
 */
export async function phase15Docs(ctx) {
  section("Phase 15 — API documentation");
  const BASE = "http://127.0.0.1:4311";

  // ── The docs page renders ──────────────────────────────────────────────
  const page = await fetch(`${BASE}/docs`);
  const html = await page.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ");

  check("the /docs page renders (200)", page.status === 200, `got ${page.status}`);
  check("it has an introduction", text.includes("Introduction"), "missing");
  check("it has a quickstart", text.includes("Quickstart"), "missing");
  check("it documents the three realms", text.includes("fa_admin_session"), "missing");
  check("it documents the public login endpoint",
    text.includes("/api/v1/auth/login"), "missing");
  check("it documents error codes", text.includes("ACCOUNT_BANNED"), "missing");
  check("it documents rate limits", text.includes("Rate limits"), "missing");
  check("it documents the subscription plans", text.includes("Unlimited"), "missing");

  // ── The OpenAPI spec is served and well formed ────────────────────────
  const specRes = await fetch(`${BASE}/docs/openapi.json`);
  check("the OpenAPI document is served (200)", specRes.status === 200, `got ${specRes.status}`);
  check("it is served as JSON",
    (specRes.headers.get("content-type") ?? "").includes("application/json"),
    String(specRes.headers.get("content-type")));

  const spec = await specRes.json();
  check("it declares OpenAPI 3.1", spec.openapi === "3.1.0", String(spec.openapi));
  check("it has a title", typeof spec.info?.title === "string");
  check("it defines the three security schemes",
    Boolean(spec.components?.securitySchemes?.bearerAuth) &&
    Boolean(spec.components?.securitySchemes?.cookieAuth) &&
    Boolean(spec.components?.securitySchemes?.adminCookieAuth),
    JSON.stringify(Object.keys(spec.components?.securitySchemes ?? {})));

  // The server URL is derived from the incoming request so the spec is correct
  // for whatever host the deployment uses. Compare the port, since Next
  // normalises 127.0.0.1 -> localhost.
  const specOrigin = spec.servers?.[0]?.url ?? "";
  check("it points the spec at this deployment's port",
    specOrigin.endsWith(String(BASE.split(":").pop())),
    `${specOrigin} vs ${BASE}`);

  // ── Every documented path must actually exist ─────────────────────────
  // Use a FRESH operator session. `ctx.owner` is the CUSTOMER cookie jar —
  // signing the operator in there would clobber the customer's session cookie
  // and break the phases that run afterwards.
  const operator = new Session();
  const signedIn = await call(operator, "POST", "/api/admin/auth/login", {
    identifier: "root", password: "RootAdmin1",
  });
  check("re-authenticated as operator for the path probe", signedIn.status === 200,
    `got ${signedIn.status}`);

  const documented = Object.keys(spec.paths ?? {});
  check("the spec documents every endpoint group",
    documented.some((p) => p.startsWith("/api/v1/")) &&
    documented.some((p) => p.startsWith("/api/dashboard/")) &&
    documented.some((p) => p.startsWith("/api/admin/")),
    documented.join(", "));

  // Probe each documented path USING THE METHOD THE SPEC DECLARES. Probing a
  // POST-only route with GET returns Next's HTML 405, which would look like a
  // missing route when it is not.
  let notJson = 0;
  const offenders = [];
  for (const [template, operations] of Object.entries(spec.paths ?? {})) {
    const method = (Object.keys(operations)[0] ?? "GET").toUpperCase();
    const concrete = template.replace(/:\w+/g, "000000000000000000000000");
    // `fetch` rejects any body on GET/HEAD, so build the init conditionally
    // rather than passing `body: undefined`.
    const sendsBody = method !== "GET" && method !== "HEAD";
    const res = await fetch(`${BASE}${concrete}`, {
      method,
      headers: {
        Cookie: operator.header(),
        ...(sendsBody ? { "Content-Type": "application/json" } : {}),
      },
      ...(sendsBody ? { body: "{}" } : {}),
    });
    // A real route always answers with the JSON envelope — even for auth or
    // validation failures. Only an unrouted path returns HTML.
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("application/json")) {
      notJson += 1;
      offenders.push(`${method} ${template} -> ${res.status}`);
    }
  }
  check("every documented path is a real, JSON-returning route", notJson === 0,
    `${notJson}/${documented.length} did not return JSON: ${offenders.slice(0, 3).join("; ")}`);

  // ── The reverse: a real endpoint must be documented ────────────────────
  const spotChecks = [
    "/api/v1/auth/login",
    "/api/v1/auth/validate",
    "/api/dashboard/applications",
    "/api/dashboard/applications/:appId/users",
    "/api/dashboard/applications/:appId/users/:userId/ban",
    "/api/admin/customers/:userId/plan",
  ];
  for (const path of spotChecks) {
    check(`the spec documents ${path}`,
      Object.prototype.hasOwnProperty.call(spec.paths ?? {}, path),
      `missing from spec`);
  }

  // ── The spec must never leak secrets ──────────────────────────────────
  const serialised = JSON.stringify(spec);
  check("the spec contains no bcrypt hashes", !serialised.includes("$2b$"));
  check("the spec contains no live tokens", !serialised.includes(ctx.token1 ?? "___none___"));
  check("the docs page contains no bcrypt hashes", !text.includes("$2b$"));

  // ── No hardcoded domains anywhere ──────────────────────────────────────
  // The catalogue must carry a {{BASE_URL}} placeholder that is substituted at
  // render time, so the snippets are correct on any self-hosted domain.
  check("the rendered docs contain no hardcoded example domain",
    !text.includes("your-domain"), "your-domain leaked into the rendered docs");
  check("the OpenAPI spec contains no hardcoded example domain",
    !serialised.includes("your-domain"), "your-domain leaked into the spec");

  // The server-rendered HTML shows the placeholder (the real origin is only
  // known in the browser); it must never show a made-up domain.
  check("the server-rendered docs use the BASE_URL placeholder",
    html.includes("{{BASE_URL}}"),
    "placeholder missing from the static HTML");
  check("the OpenAPI spec resolves the placeholder to this deployment",
    serialised.includes("http://localhost:4311/api/v1/auth/login") ||
      serialised.includes("http://127.0.0.1:4311/api/v1/auth/login"),
    "the spec did not substitute the deployment origin");
  check("no unresolved placeholder leaks into the OpenAPI spec",
    !serialised.includes("{{BASE_URL}}"),
    "an unresolved {{BASE_URL}} remained in the spec");

  // The spec carries a runnable cURL sample per operation, with the base URL
  // resolved to this deployment.
  const loginOp = spec.paths["/api/v1/auth/login"]?.post;
  check("the spec includes a runnable cURL sample",
    typeof loginOp?.["x-curl-example"] === "string",
    "x-curl-example missing");
  check("the cURL sample uses this deployment's origin, not a placeholder",
    typeof loginOp?.["x-curl-example"] === "string" &&
      loginOp["x-curl-example"].includes("http://localhost:4311/api/v1/auth/login"),
    String(loginOp?.["x-curl-example"]).slice(0, 90));

  // ─────────────────────────────────────────────────────────────────────────
  // The docs catalogue must cover the real API surface. Without this, an
  // endpoint can ship undocumented and every assertion above still passes —
  // they prove the docs RENDER, not that they are COMPLETE.
  //
  // `npm run audit:docs` is the same comparison, run here so drift fails the
  // suite rather than waiting for someone to remember to run it.
  // ─────────────────────────────────────────────────────────────────────────
  const audit = spawnSync(process.execPath, ["scripts/audit-docs.mjs"], {
    encoding: "utf8",
  });
  check("every route handler and error code is documented", audit.status === 0,
    ((audit.stdout ?? "") + (audit.stderr ?? "")).slice(0, 400));
}
