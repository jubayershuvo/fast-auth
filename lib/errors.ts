/**
 * Canonical error codes + the API envelope.
 *
 * Every response in this app has exactly one shape:
 *   success: { success: true,  data: T }
 *   failure: { success: false, error: string, message: string, details?: unknown }
 *
 * Error codes are stable strings (they are part of the public API contract and
 * appear in SDKs / client code), messages are human-facing and may change.
 */

export const ErrorCode = {
  // --- request / validation ---
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",

  // --- auth ---
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  SESSION_REVOKED: "SESSION_REVOKED",

  // --- application-user (v1 API) ---
  INVALID_APPLICATION: "INVALID_APPLICATION",
  INVALID_APP_SECRET: "INVALID_APP_SECRET",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  ACCOUNT_BANNED: "ACCOUNT_BANNED",
  ACCOUNT_EXPIRED: "ACCOUNT_EXPIRED",
  DEVICE_LIMIT_REACHED: "DEVICE_LIMIT_REACHED",
  DEVICE_MISMATCH: "DEVICE_MISMATCH",
  /** The caller already holds the maximum number of concurrent sessions. */
  TOO_MANY_SESSIONS: "TOO_MANY_SESSIONS",

  // --- account creation / email verification ---
  /**
   * The email+password sign-in method is switched off for this deployment.
   *
   * Distinct from FORBIDDEN because the remedy is entirely different: the caller
   * is not under-privileged, they are using a method the operator has retired.
   * A client can branch on this code to hide the password form and show the
   * social buttons instead.
   */
  AUTH_METHOD_DISABLED: "AUTH_METHOD_DISABLED",
  /**
   * Sign-in was refused because the address has not been verified yet.
   *
   * Deliberately NOT a generic "invalid credentials": the person has already
   * proven who they are (correct password), and telling them to re-check a
   * password they got right is the kind of message that makes people give up.
   */
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  /**
   * This account has no password — it was created by an operator or through
   * social sign-in.
   *
   * This one IS an enumeration oracle, and that is an accepted trade-off: the
   * alternative is telling someone with a real, correct account "incorrect
   * password" forever with no route forward. The response reveals only whether
   * ONE address exists, never anything about other accounts, and it is
   * rate-limited exactly like sign-in itself.
   */
  NO_PASSWORD_SET: "NO_PASSWORD_SET",
  /** The emailed code was wrong, or no live code was ever issued. */
  INVALID_VERIFICATION_CODE: "INVALID_VERIFICATION_CODE",
  /** The emailed code was correct but has passed its expiry. */
  VERIFICATION_CODE_EXPIRED: "VERIFICATION_CODE_EXPIRED",
  /** The code was right but its attempt budget was already spent. */
  TOO_MANY_CODE_ATTEMPTS: "TOO_MANY_CODE_ATTEMPTS",
  /** The server could not hand the message to SMTP. Retry shortly. */
  EMAIL_DELIVERY_FAILED: "EMAIL_DELIVERY_FAILED",

  // --- API keys (machine realm) ---
  /**
   * The `X-Api-Key` header is missing, unknown, expired or revoked.
   *
   * Deliberately ONE code for all four cases: telling a caller "this key was
   * revoked" vs "this key does not exist" turns the endpoint into an oracle for
   * enumerating live credentials, which is the one thing a management API must
   * never be.
   */
  INVALID_API_KEY: "INVALID_API_KEY",
  /** A valid key, but its scope does not cover this application. */
  API_KEY_SCOPE_DENIED: "API_KEY_SCOPE_DENIED",

  // --- self-service portal (application end users) ---
  /**
   * A device cannot be deleted yet because it was active too recently.
   *
   * Its own code because the remedy is TIME, not permission: the caller is
   * perfectly entitled to remove this device, they just cannot remove it *now*.
   * A generic 403 would read as "you are not allowed", which would send the
   * owner to the application's support for something that resolves itself.
   */
  DEVICE_STILL_ACTIVE: "DEVICE_STILL_ACTIVE",
  /** The supplied current-password did not match. */
  CURRENT_PASSWORD_INCORRECT: "CURRENT_PASSWORD_INCORRECT",
  /** The new password is identical to the current one. */
  PASSWORD_UNCHANGED: "PASSWORD_UNCHANGED",

  /**
   * The application is stopped by its owner. Distinct from ACCOUNT_BANNED on
   * purpose: the end user is fine, the whole application is switched off, and
   * the client should say so differently rather than blaming the user.
   */
  APP_SUSPENDED: "APP_SUSPENDED",

  // --- conflicts ---
  EMAIL_TAKEN: "EMAIL_TAKEN",
  USERNAME_TAKEN: "USERNAME_TAKEN",
  DUPLICATE: "DUPLICATE",

  // --- subscriptions ---
  APP_LIMIT_REACHED: "APP_LIMIT_REACHED",
  INVALID_PLAN: "INVALID_PLAN",

  // --- throttling / server ---
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** An error carrying an HTTP status and a stable machine-readable code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCodeValue;
  readonly details?: unknown;

  constructor(
    status: number,
    code: ErrorCodeValue,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static unauthorized(message = "Authentication required.", code: ErrorCodeValue = ErrorCode.UNAUTHORIZED) {
    return new ApiError(401, code, message);
  }

  static forbidden(message = "You do not have access to this resource.") {
    return new ApiError(403, ErrorCode.FORBIDDEN, message);
  }

  static notFound(message = "Resource not found.") {
    return new ApiError(404, ErrorCode.NOT_FOUND, message);
  }

  static conflict(code: ErrorCodeValue, message: string) {
    return new ApiError(409, code, message);
  }

  static validation(message: string, details?: unknown) {
    return new ApiError(400, ErrorCode.VALIDATION_ERROR, message, details);
  }

  static rateLimited(message = "Too many requests. Please try again later.") {
    return new ApiError(429, ErrorCode.RATE_LIMITED, message);
  }

  static internal(message = "An unexpected error occurred.") {
    return new ApiError(500, ErrorCode.INTERNAL_ERROR, message);
  }

  /** 503: a dependency (mail transport) is unavailable. Retry shortly. */
  static unavailable(message = "A required service is temporarily unavailable.") {
    return new ApiError(503, ErrorCode.SERVICE_UNAVAILABLE, message);
  }
}
