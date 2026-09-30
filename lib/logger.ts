import "server-only";

import type { Types } from "mongoose";

import { connectToDatabase } from "@/lib/mongodb";
import { AuthLogModel } from "@/models/AuthLog";
import type { AuthActionValue } from "@/models/AuthLog";

/**
 * Authentication audit trail.
 *
 * Design rules:
 *  - Logging must NEVER break the request it is describing. Failures are
 *    swallowed and reported to the server console, not to the client.
 *  - Only identifiers and outcomes are stored: never passwords, never tokens,
 *    never the app secret.
 */

export type AuthLogInput = {
  applicationId: Types.ObjectId | string;
  userId?: Types.ObjectId | string | null;
  username?: string | null;
  action: AuthActionValue;
  success: boolean;
  /** Machine-readable code such as ACCOUNT_BANNED. */
  reason?: string | null;
  ip?: string | null;
  deviceId?: string | null;
  userAgent?: string | null;
};

export async function recordAuthEvent(input: AuthLogInput): Promise<void> {
  try {
    await connectToDatabase();
    await AuthLogModel.create({
      applicationId: input.applicationId,
      userId: input.userId ?? null,
      username: input.username ?? null,
      action: input.action,
      success: input.success,
      // Bound the field so a long reason can never bloat the document.
      reason: input.reason ? input.reason.slice(0, 64) : null,
      ip: input.ip ? input.ip.slice(0, 64) : null,
      deviceId: input.deviceId ? input.deviceId.slice(0, 128) : null,
      userAgent: input.userAgent ? input.userAgent.slice(0, 300) : null,
    });
  } catch (error) {
    // A failed audit write must not fail the user's login.
    console.error("[logger] Failed to record auth event:", input.action, error);
  }
}
