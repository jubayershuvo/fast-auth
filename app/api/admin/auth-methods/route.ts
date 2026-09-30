import { NextResponse } from "next/server";
import { z } from "zod";

import { apiSuccess, handleApiError, readJsonBody } from "@/lib/api-response";
import { listAuthMethodConfigs, updateAuthMethod } from "@/lib/auth-method";
import { requireAdminIdentity } from "@/lib/admin-session";

/**
 * GET   /api/admin/auth-methods — configuration (SMTP password masked)
 * PATCH /api/admin/auth-methods — enable/disable, or set the SMTP transport
 *
 * Operator-only, exactly like /api/admin/oauth/providers.
 *
 * The SMTP password is WRITE-ONLY: accepted here, encrypted at rest, and never
 * returned by any endpoint. A blank field means "keep the stored password", so
 * the toggle can be flipped without re-pasting credentials.
 *
 * The enable gate lives in `updateAuthMethod`, not here, so the rule cannot be
 * bypassed by another caller.
 */
const updateSchema = z.object({
  method: z.enum(["email_password"]).default("email_password"),
  enabled: z.boolean().optional(),
  allowRegistration: z.boolean().optional(),
  // A hostname only: no scheme, path, port or credentials. A full URL here
  // would be passed to nodemailer verbatim, and `smtp://user:pass@evil.host`
  // would turn the operator panel into a credential-forwarding primitive.
  smtpHost: z
    .string()
    .trim()
    .max(253)
    .regex(
      /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/,
      "Enter a bare host name, e.g. smtp.example.com",
    )
    .nullable()
    .optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecure: z.enum(["starttls", "ssl", "none"]).optional(),
  smtpUser: z.string().trim().max(254).nullable().optional(),
  // Blank means "keep the stored secret".
  smtpPassword: z.string().trim().max(512).optional(),
  mailFrom: z.string().trim().max(254).nullable().optional(),
});

export async function GET(): Promise<NextResponse> {
  try {
    await requireAdminIdentity();
    return apiSuccess({ methods: await listAuthMethodConfigs() });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const admin = await requireAdminIdentity();
    const input = updateSchema.parse(await readJsonBody<unknown>(request));

    const updated = await updateAuthMethod(
      input.method,
      {
        enabled: input.enabled,
        allowRegistration: input.allowRegistration,
        smtpHost: input.smtpHost,
        smtpPort: input.smtpPort,
        smtpSecure: input.smtpSecure,
        smtpUser: input.smtpUser,
        smtpPassword: input.smtpPassword,
        mailFrom: input.mailFrom,
      },
      admin.email,
    );

    return apiSuccess({ method: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
