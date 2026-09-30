"use client";

/**
 * Typed fetch wrapper for dashboard API calls.
 *
 * Unwraps the `{ success, data }` envelope so callers get the payload
 * directly, and converts the failure envelope into a thrown `ApiClientError`
 * carrying the stable `code` so the UI can react to specific cases
 * (e.g. DEVICE_LIMIT_REACHED) without string matching on messages.
 */

export type ApiErrorPayload = {
  success: false;
  error: string;
  message: string;
  details?: Record<string, string>;
};

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, string>;

  constructor(payload: ApiErrorPayload, status: number) {
    super(payload.message);
    this.name = "ApiClientError";
    this.code = payload.error;
    this.status = status;
    this.details = payload.details;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
};

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal } = options;

  const response = await fetch(path, {
    method,
    signal,
    // Send cookies so the httpOnly session travels with the request.
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError(
      { success: false, error: "INTERNAL_ERROR", message: "Unexpected server response." },
      response.status,
    );
  }

  if (!response.ok) {
    throw new ApiClientError(payload as ApiErrorPayload, response.status);
  }

  return (payload as { data: T }).data;
}
