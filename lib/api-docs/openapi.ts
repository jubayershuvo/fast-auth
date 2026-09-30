import { ALL_ENDPOINTS } from "./index";
import { substituteBaseUrl } from "./base-url";
import { ERROR_CODES, type EndpointDoc, type ParamDoc } from "./types";

/**
 * Generates an OpenAPI 3.1 document from the same catalogue that renders the
 * in-app docs, so the two can never disagree about what the API looks like.
 *
 * Hand-rolled rather than pulled from a dependency: the document is fully
 * derived from data we already maintain, and a generator would add a
 * build-time dependency for no extra fidelity.
 */

const JSON_TYPE: Record<string, string> = {
  string: "string",
  number: "integer",
  boolean: "boolean",
  object: "object",
};

/** `{appId}` -> `:appId`, the OpenAPI path-template form. */
function toOpenApiPath(path: string): string {
  return path.replace(/\{(\w+)\}/g, ":$1");
}

function parameterFor(param: ParamDoc) {
  return {
    name: param.name,
    in: param.in,
    required: param.required,
    description: param.description,
    ...(param.example ? { example: param.example } : {}),
    schema: { type: JSON_TYPE[param.type] ?? "string" },
  };
}

/** Substitute the base URL inside a generated parameter object. */
function substituteInParameter<T extends Record<string, unknown>>(
  parameter: T,
  baseUrl: string,
): T {
  const next: Record<string, unknown> = { ...parameter };
  if (typeof next.description === "string") {
    next.description = substituteBaseUrl(next.description, baseUrl);
  }
  if (typeof next.example === "string") {
    next.example = substituteBaseUrl(next.example, baseUrl);
  }
  return next as T;
}

/** Substitute the base URL inside a generated requestBody object. */
function substituteInBody(body: Record<string, unknown>, baseUrl: string) {
  const content = body.content as
    | Record<string, { schema: { properties?: Record<string, { description?: string; example?: unknown }> } }>
    | undefined;
  const json = content?.["application/json"];
  if (!json?.schema.properties) return body;

  const properties = Object.fromEntries(
    Object.entries(json.schema.properties).map(([key, value]) => {
      const copy = { ...value };
      if (typeof copy.description === "string") {
        copy.description = substituteBaseUrl(copy.description, baseUrl);
      }
      if (typeof copy.example === "string") {
        copy.example = substituteBaseUrl(copy.example, baseUrl);
      }
      return [key, copy];
    }),
  );

  return {
    ...body,
    content: { ...content, "application/json": { schema: { ...json.schema, properties } } },
  };
}

/**
 * Body parameters are not part of the OpenAPI parameter object, so they are
 * collected into a single requestBody schema.
 */
function requestBodyFor(body: ParamDoc[]) {
  if (body.length === 0) return undefined;
  return {
    required: body.some((p) => p.required),
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: Object.fromEntries(
            body.map((p) => [
              p.name,
              {
                type: JSON_TYPE[p.type] ?? "string",
                description: p.description,
                ...(p.example ? { example: p.example } : {}),
              },
            ]),
          ),
          required: body.filter((p) => p.required).map((p) => p.name),
        },
      },
    },
  };
}

const SECURITY: Record<EndpointDoc["auth"], object[] | undefined> = {
  none: undefined,
  bearer: [{ bearerAuth: [] }],
  cookie: [{ cookieAuth: [] }],
  "admin-cookie": [{ adminCookieAuth: [] }],
  "portal-cookie": [{ portalCookieAuth: [] }],
  "api-key": [{ apiKeyAuth: [] }],
};

/** Examples are written as pretty JSON; fall back to text if not parseable. */
function parseExample(code: string): unknown {
  try {
    return JSON.parse(code);
  } catch {
    return { raw: code };
  }
}

/**
 * Substitution is threaded through the generators rather than applied to the
 * finished document, so example strings keep their shape (a JSON example stays
 * valid JSON instead of becoming a blob of escaped text).
 */
function responsesFor(endpoint: EndpointDoc, baseUrl: string) {
  const responses: Record<string, object> = {};

  responses[String(endpoint.successStatus ?? 200)] = {
    description: "Success",
    ...(endpoint.responseExample
      ? {
          content: {
            "application/json": {
              example: parseExample(
                substituteBaseUrl(endpoint.responseExample.code, baseUrl),
              ),
            },
          },
        }
      : {}),
  };

  for (const error of endpoint.errors ?? []) {
    responses[String(error.status)] = {
      description: `${error.code} — ${error.when}`,
      content: {
        "application/json": {
          example: { success: false, error: error.code, message: error.when },
        },
      },
    };
  }

  return responses;
}

function operationFor(endpoint: EndpointDoc, baseUrl: string) {
  const list = endpoint.params ?? [];
  const inPlace = list.filter((p) => p.in !== "body");
  const body = list.filter((p) => p.in === "body");
  const requestBody = requestBodyFor(body);

  return {
    operationId: endpoint.id,
    summary: endpoint.summary,
    description: substituteBaseUrl(
      [
        endpoint.title,
        ...(endpoint.notes ?? []),
        ...(endpoint.auth === "bearer"
          ? ["Requires a bearer session token obtained from `POST /api/v1/auth/login`."]
          : []),
      ].join("\n\n"),
      baseUrl,
    ),
    tags: [endpoint.group],
    security: SECURITY[endpoint.auth],
    // The cURL sample is carried through so Postman/Insomnia users and anyone
    // reading the raw spec get a runnable example. The base URL is resolved
    // here, so the spec never ships a placeholder.
    ...(endpoint.requestExample
      ? {
          "x-curl-example": substituteBaseUrl(endpoint.requestExample.code, baseUrl),
        }
      : {}),
    ...(inPlace.length > 0
      ? {
          parameters: inPlace.map((param) =>
            substituteInParameter(parameterFor(param), baseUrl),
          ),
        }
      : {}),
    ...(requestBody ? { requestBody: substituteInBody(requestBody, baseUrl) } : {}),
    responses: responsesFor(endpoint, baseUrl),
  };
}

const API_DESCRIPTION = [
  "Authentication, licensing and device management for your applications.",
  "",
  "## Response envelope",
  "Every response uses one of two shapes:",
  "",
  "```json",
  '{ "success": true, "data": { } }',
  '{ "success": false, "error": "CODE", "message": "Human readable." }',
  "```",
  "",
  "`error` is a stable machine-readable code; `message` is for humans.",
  "",
  "## Four realms, four credentials",
  "",
  "| Realm | Credential | Used by |",
  "| --- | --- | --- |",
  "| End user | `Authorization: Bearer <sessionToken>` | your game / desktop app |",
  "| API key | `X-Api-Key: fak_...` | your backend, scripts, CI |",
  "| Customer | httpOnly `fa_session` cookie | the dashboard |",
  "| Operator | httpOnly `fa_admin_session` cookie | platform administration only |",
  "",
  "These are never interchangeable.",
  "",
  "## Expiry semantics",
  "",
  "`expiresAt` is an absolute ISO-8601 instant; `null` means the licence never",
  "expires. A user is rejected with `ACCOUNT_EXPIRED` once `expiresAt` has passed.",
  "",
  "## Device limits",
  "",
  "`deviceId` is a client-supplied identifier. It caps how many devices may",
  "activate one licence at a time — a seat-control mechanism, not tamper-proof",
  "hardware attestation.",
].join("\n");

export function buildOpenApiDocument(baseUrl: string) {
  const paths: Record<string, Record<string, object>> = {};

  for (const endpoint of ALL_ENDPOINTS) {
    const path = toOpenApiPath(endpoint.path);
    paths[path] ??= {};
    paths[path][endpoint.method.toLowerCase()] = operationFor(endpoint, baseUrl);
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "FastAuth API",
      version: "1.0.0",
      description: substituteBaseUrl(API_DESCRIPTION, baseUrl),
    },
    servers: [{ url: baseUrl, description: "This deployment" }],
    tags: [
      { name: "v1", description: "Public API — end-user authentication from your application." },
      { name: "keys", description: "API keys — server-to-server management of applications, users and devices." },
      { name: "dashboard", description: "Customer API — manage your applications and users from the dashboard." },
      { name: "admin", description: "Operator API — platform administration only." },
      { name: "portal", description: "Self-service portal — an application's own end user, in a browser." },
    ],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "A session token from POST /api/v1/auth/login.",
        },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "fa_session",
          description: "The customer dashboard session cookie.",
        },
        adminCookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "fa_admin_session",
          description: "The platform-operator session cookie.",
        },
        portalCookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "fa_app_session",
          description: "An application end user's portal session cookie.",
        },
        apiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-Api-Key",
          description:
            "A management API key from `npm run create-api-key`. A platform key manages every application; an app key is pinned to one application and manages its users and devices.",
        },
      },
      schemas: {
        SuccessEnvelope: {
          type: "object",
          required: ["success", "data"],
          properties: { success: { const: true }, data: { type: "object" } },
        },
        ErrorEnvelope: {
          type: "object",
          required: ["success", "error", "message"],
          properties: {
            success: { const: false },
            error: { type: "string", enum: ERROR_CODES.map((e) => e.code) },
            message: { type: "string" },
            details: { type: "object", additionalProperties: { type: "string" } },
          },
        },
      },
    },
    paths,
  };
}

