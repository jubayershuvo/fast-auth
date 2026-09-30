import "server-only";

import { Types } from "mongoose";

import { ApiError, ErrorCode } from "@/lib/errors";
import { env } from "@/lib/env";
import { connectToDatabase } from "@/lib/mongodb";
import { getRequestContext } from "@/lib/request";
import { checkRateLimit, consumeRateLimit } from "@/lib/rate-limit";
import { hashToken } from "@/lib/tokens";
import { ApiKeyModel, type ApiKeyScope } from "@/models/ApiKey";
import { ApplicationModel } from "@/models/Application";

/**
 * API-key authentication — the machine realm behind `/api/keys/*`.
 *
 * WHY THIS EXISTS: the dashboard API is cookie-authenticated, which is correct
 * for a browser and useless for a customer's own backend. A provisioning script
 * has no business holding a session cookie. This module is the fourth, entirely
 * separate credential path.
 *
 * THE INVARIANT, mirroring lib/authorization.ts:
 *
 *   valid, unrevoked, unexpired API key
 *     -> scope "app"      => key.applicationId === target application
 *     -> scope "platform" => no application constraint
 *
 * A path `appId` is only ever a LOOKUP KEY. It is compared against the scope
 * bound to the credential, so widening access to a second application requires
 * a new key issued by the operator — it is never something a request can ask
 * for. This is what makes the "api key + appId" scope unforgeable.
 *
 * Every failure — absent, unknown, malformed, expired, revoked, wrong scope —
 * returns the same error envelope, so the endpoint cannot be used to probe which
 * keys exist, which have expired, or which applications they are pinned to.
 */

/** The header a machine client presents its key in. */
export const API_KEY_HEADER = "X-Api-Key";

/**
 * The authenticated caller.
 *
 * `applicationId` is the authority for every subsequent query — it is never
 * read from the URL — so an "app"-scoped key physically cannot address a
 * different application even if the caller edits the path.
 */
export type ApiKeyIdentity = {
  id: string;
  name: string;
  scope: ApiKeyScope;
  /** null for a platform key, which is not pinned to any application. */
  applicationId: string | null;
};

/** An application the presented key is allowed to act on. */
export type KeyedApplication = {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  name: string;
  description: string;
  /** The PUBLIC `fa_...` id. Distinct from the ObjectId used in paths. */
  appId: string;
  appSecretFingerprint: string;
  appSecretRotatedAt: Date;
  status?: "active" | "suspended";
  createdAt: Date;
  updatedAt: Date;
};

/** Read the raw header. Returns null when absent, so callers can distinguish. */
function readApiKeyHeader(request: Request): string | null {
  const raw = request.headers.get(API_KEY_HEADER);
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Refuse a flood of bad keys before any database work.
 *
 * Keyed on IP only, and it is NOT reset on success: it throttles requests
 * presenting an invalid key, not requests from a busy-but-valid integration.
 * Clearing it on success would let an attacker reset the budget by appending a
 * guessed key to a valid one.
 */

/**
 * Authenticate an `X-Api-Key` header.
 *
 * Returns null for EVERY failure mode so there is a single call site for the
 * refusal. The database lookup is by hash, so a wrong key costs one indexed
 * lookup and nothing more — no password hash, no comparison oracle.
 */
export async function resolveApiKey(
  request: Request,
): Promise<ApiKeyIdentity | null> {
  const presented = readApiKeyHeader(request);
  if (!presented) return null;

  assertNotRateLimited(request);

  await connectToDatabase();

  // `+keyHash` because it is `select: false` — the only way to read it is to
  // ask for it explicitly.
  const key = await ApiKeyModel.findOne({ keyHash: hashToken(presented) })
    .select("+keyHash")
    .lean();

  if (!key) return null;
  if (key.revokedAt !== null) return null;
  if (key.expiresAt !== null && key.expiresAt.getTime() <= Date.now()) return null;

  // A malformed row is treated as a failed key rather than being trusted: a
  // half-configured key must never silently behave as a platform key.
  if (key.scope === "app" && !key.applicationId) return null;
  if (key.scope === "platform" && key.applicationId) return null;

  // Liveness bookkeeping. Fire-and-forget: an operator reading `lastUsedAt`
  // must never be able to slow down or fail a customer's provisioning call.
  const { ip } = getRequestContext(request);
  void ApiKeyModel.updateOne(
    { _id: key._id },
    { $set: { lastUsedAt: new Date(), lastUsedIp: ip ?? null } },
  ).catch(() => undefined);

  return {
    id: key._id.toString(),
    name: key.name,
    scope: key.scope,
    applicationId: key.applicationId ? key.applicationId.toString() : null,
  };
}

/** Step 1: the caller must present a valid, live API key. */
export async function requireApiKey(request: Request): Promise<ApiKeyIdentity> {
  const identity = await resolveApiKey(request);
  if (!identity) {
    throw new ApiError(
      401,
      ErrorCode.INVALID_API_KEY,
      `A valid API key is required. Send it in the ${API_KEY_HEADER} header.`,
    );
  }
  return identity;
}

/** Step 2: the key must be platform-scoped to manage applications themselves. */
export async function requirePlatformApiKey(
  request: Request,
): Promise<ApiKeyIdentity> {
  const identity = await requireApiKey(request);
  if (identity.scope !== "platform") {
    // NOT a 404. The key is genuinely valid — the caller is simply asking for
    // something it was not issued for, and silently hiding that would make the
    // scope model impossible to debug. The message names no application, so it
    // still leaks nothing about other tenants.
    throw new ApiError(
      403,
      ErrorCode.API_KEY_SCOPE_DENIED,
      "This API key is scoped to a single application and cannot manage applications. Issue a platform key for that.",
    );
  }
  return identity;
}

/**
 * Step 2 (app-scoped): resolve `{appId}` and prove this key may act on it.
 *
 * The comparison is made against the KEY's `applicationId`, never against
 * anything in the request, so a caller editing the path only ever causes a
 * refusal.
 */
export async function requireKeyedApplication(
  request: Request,
  applicationId: string,
): Promise<{ key: ApiKeyIdentity; application: KeyedApplication }> {
  const key = await requireApiKey(request);
  await connectToDatabase();

  if (!Types.ObjectId.isValid(applicationId)) {
    throw ApiError.validation("Invalid application id.");
  }
  const objectId = new Types.ObjectId(applicationId);

  // A platform key may act on any application. An app key may act on exactly
  // one, and BOTH constraints go into a single query so that a mismatch is
  // indistinguishable from an id that does not exist.
  //
  // CRITICAL: the scope constraint is expressed on `_id`. An Application
  // document has no field called `applicationId` — it IS the tenancy boundary,
  // identified by `_id`. An earlier version filtered on
  // `{ _id: pathId, applicationId: key.applicationId }`; Mongoose's
  // strictQuery silently DROPS the unknown `applicationId` key, leaving a bare
  // `{_id}` that matches ANY application on the platform. An app-scoped key
  // could then read and create users in another tenant's app. The phase-16
  // cross-tenant assertions exist to catch exactly that class of bug.
  const filter =
    key.scope === "platform" || key.applicationId === null
      ? { _id: objectId }
      : {
          $and: [
            { _id: objectId },
            { _id: new Types.ObjectId(key.applicationId) },
          ],
        };

  const application = await ApplicationModel.findOne(filter).lean();
  if (!application) {
    throw ApiError.notFound("Application not found.");
  }

  return { key, application };
}

/** The Mongo id of the application the caller is acting on. */
export function keyedApplicationId(application: KeyedApplication): string {
  return application._id.toString();
}

function assertNotRateLimited(request: Request): void {
  const { ip } = getRequestContext(request);
  const key = `api-key:${ip ?? "unknown"}`;
  const max = env.apiKeyRateLimitMax;

  if (!checkRateLimit(key, max).allowed) {
    throw ApiError.rateLimited(
      "Too many invalid API key attempts. Try again shortly.",
    );
  }
  consumeRateLimit(key, max, env.apiKeyRateLimitWindowMs);
}
