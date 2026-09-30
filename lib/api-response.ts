import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, ErrorCode, type ErrorCodeValue } from "@/lib/errors";

/** The two response shapes every endpoint in this app returns. */
export type ApiSuccess<T> = { success: true; data: T };
export type ApiFailure = {
  success: false;
  error: ErrorCodeValue;
  message: string;
  details?: unknown;
};

const BASE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "X-Content-Type-Options": "nosniff",
};

export function apiSuccess<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ success: true, data }, { status, headers: BASE_HEADERS });
}

export function apiFailure(
  error: ErrorCodeValue,
  message: string,
  status: number,
  details?: unknown,
): NextResponse<ApiFailure> {
  return NextResponse.json(
    { success: false, error, message, ...(details === undefined ? {} : { details }) },
    { status, headers: BASE_HEADERS },
  );
}

/**
 * Convert a `ZodError` into a flat, client-friendly field map.
 * Path[0] is the field name, message is the human-facing reason.
 */
function zodDetails(error: ZodError): Record<string, string> {
  const details: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path.length > 0 ? issue.path.join(".") : "_root";
    if (!(field in details)) details[field] = issue.message;
  }
  return details;
}

/**
 * The single exit point for route handlers. Converts anything thrown into the
 * standard failure envelope so handlers never leak stack traces or raw driver
 * errors to clients.
 */
export function handleApiError(error: unknown): NextResponse<ApiFailure> {
  if (error instanceof ApiError) {
    return apiFailure(error.code, error.message, error.status, error.details);
  }

  if (error instanceof ZodError) {
    return apiFailure(
      ErrorCode.VALIDATION_ERROR,
      "The request payload is invalid.",
      400,
      zodDetails(error),
    );
  }

  // Mongoose duplicate key -> 409 rather than an opaque 500.
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  ) {
    return apiFailure(
      ErrorCode.DUPLICATE,
      "That value is already in use.",
      409,
    );
  }

  if (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "MongoNetworkError" ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "MongooseServerSelectionError")
  ) {
    return apiFailure(
      ErrorCode.SERVICE_UNAVAILABLE,
      "The database is currently unavailable. Please retry shortly.",
      503,
    );
  }

  // Log server-side, return nothing sensitive to the client.
  console.error("[api] Unhandled error:", error);
  return apiFailure(
    ErrorCode.INTERNAL_ERROR,
    "An unexpected error occurred.",
    500,
  );
}

/**
 * Read and parse a JSON body with a hard size cap, so a malicious client
 * cannot force the server to buffer an unbounded payload.
 */
export async function readJsonBody<T>(
  request: Request,
  maxBytes = 16_384,
): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiError(
      415,
      ErrorCode.VALIDATION_ERROR,
      "Content-Type must be application/json.",
    );
  }

  const declared = request.headers.get("content-length");
  if (declared && Number.parseInt(declared, 10) > maxBytes) {
    throw new ApiError(413, ErrorCode.PAYLOAD_TOO_LARGE, "Request body is too large.");
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    throw ApiError.validation("Could not read the request body.");
  }

  if (text.length > maxBytes) {
    throw new ApiError(413, ErrorCode.PAYLOAD_TOO_LARGE, "Request body is too large.");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw ApiError.validation("Request body is not valid JSON.");
  }
}
