import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { completeOAuth, STATE_COOKIE } from "@/lib/oauth-flow";
import { isOAuthProviderId } from "@/lib/oauth-providers";
import { resolveAdminIdentity } from "@/lib/oauth-user";
import { createAdminSession } from "@/lib/admin-session";
import { getRequestContext } from "@/lib/request";
import { connectToDatabase } from "@/lib/mongodb";
import { AdminUserModel } from "@/models/AdminUser";

/**
 * GET /api/admin/oauth/:provider/callback
 *
 * `resolveAdminIdentity` NEVER creates an administrator — it only matches a
 * pre-existing one. That is what stops "enable Google for admins" from
 * granting platform access to every Google account on the internet.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/admin/oauth/[provider]/callback">,
): Promise<NextResponse> {
  const url = new URL(request.url);

  try {
    const { provider } = await ctx.params;
    if (!isOAuthProviderId(provider)) {
      return NextResponse.json(
        { success: false, error: "VALIDATION_ERROR", message: "Unknown provider." },
        { status: 400 },
      );
    }

    if (url.searchParams.get("error")) {
      return NextResponse.redirect(
        new URL("/admin/login?error=access_denied", url.origin),
      );
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) throw new Error("Missing code or state");

    const store = await cookies();
    const sealed = store.get(STATE_COOKIE)?.value;
    store.set(STATE_COOKIE, "", { path: "/api/admin/oauth", maxAge: 0 });
    if (!sealed) {
      return NextResponse.redirect(
        new URL("/admin/login?error=state_expired", url.origin),
      );
    }

    const profile = await completeOAuth({
      provider,
      realm: "admin",
      code,
      returnedState: state,
      sealed,
      request,
    });

    // Throws 403 when no pre-provisioned admin matches.
    const identity = await resolveAdminIdentity(provider, profile);

    const { ip, userAgent } = getRequestContext(request);
    await connectToDatabase();
    await AdminUserModel.updateOne(
      { _id: identity.id },
      { $set: { lastLoginAt: new Date(), lastLoginIp: ip } },
    ).catch(() => undefined);
    await createAdminSession(identity.id, { ip, userAgent });

    return NextResponse.redirect(new URL("/admin", url.origin));
  } catch {
    return NextResponse.redirect(new URL("/admin/login?error=oauth_failed", url.origin));
  }
}
