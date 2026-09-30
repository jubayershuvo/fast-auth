import { NextResponse } from "next/server";

import { buildOpenApiDocument } from "@/lib/api-docs/openapi";

/**
 * GET /docs/openapi.json
 *
 * The OpenAPI 3.1 description of this deployment, generated from the same
 * catalogue that renders the in-app docs — so the two cannot drift.
 *
 * Import it into Postman, Insomnia, Swagger UI or any codegen tool.
 */
export function GET(request: Request): NextResponse {
  const origin = new URL(request.url).origin;
  const document = buildOpenApiDocument(origin);

  return NextResponse.json(document, {
    headers: {
      // Safe to cache briefly; the doc is derived from static code.
      "Cache-Control": "public, max-age=300",
      "Content-Disposition": 'inline; filename="fastauth-openapi.json"',
    },
  });
}
