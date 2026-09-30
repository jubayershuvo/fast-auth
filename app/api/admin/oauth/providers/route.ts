import { NextResponse } from "next/server";
import { z } from "zod";

import {
  apiFailure,
  apiSuccess,
  handleApiError,
  readJsonBody,
} from "@/lib/api-response";
import { listProviderConfigs, updateProviderConfig } from "@/lib/oauth-config";
import { requireAdminIdentity } from "@/lib/admin-session";
import { isOAuthProviderId } from "@/lib/oauth-providers";

/**
 * GET  /api/admin/oauth/providers — list configuration (secrets masked)
 * PATCH /api/admin/oauth/providers — update one provider
 *
 * Operator-only. The client secret is write-only: it is accepted here,
 * encrypted, and never returned by any endpoint.
 */

const updateSchema = z.object({
  provider: z.enum(["google", "github", "azure"]),
  enabled: z.boolean().optional(),
  clientId: z.string().trim().max(512).nullable().optional(),
  // Blank means "keep the stored secret", so an operator can toggle a
  // provider without re-pasting the secret.
  clientSecret: z.string().trim().max(512).optional(),
  allowCustomerLogin: z.boolean().optional(),
  allowAdminLogin: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(): Promise<NextResponse> {
  try {
    await requireAdminIdentity();
    return apiSuccess({ providers: await listProviderConfigs() });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const admin = await requireAdminIdentity();
    const input = updateSchema.parse(await readJsonBody<unknown>(request));

    if (!isOAuthProviderId(input.provider)) {
      throw new Error("Unknown provider");
    }

    // Enabling a provider for the ADMIN realm is the highest-impact toggle
    // in the system, so it is refused unless a credential is already stored.
    if (input.enabled && input.allowAdminLogin) {
      const existing = await listProviderConfigs();
      const current = existing.find((item) => item.provider === input.provider);
      const hasNewSecret = Boolean(input.clientSecret);
      if (!current?.hasSecret && !hasNewSecret) {
        return apiFailure(
          "VALIDATION_ERROR",
          "Save the client id and secret before enabling admin sign-in.",
          400,
        );
      }
    }

    const updated = await updateProviderConfig(
      input.provider,
      {
        enabled: input.enabled,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        allowCustomerLogin: input.allowCustomerLogin,
        allowAdminLogin: input.allowAdminLogin,
        settings: input.settings,
      },
      admin.email,
    );

    return apiSuccess({ provider: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
