import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { beginOAuth, STATE_COOKIE, STATE_TTL_SECONDS } from "@/lib/oauth-flow";
import { isOAuthProviderId } from "@/lib/oauth-providers";

/**
 * GET /api/admin/oauth/:provider/start
 *
 * Operator OAuth. Reaches `getProviderConfig(..., "admin")`, which refuses
 * unless the operator has enabled the provider for the admin realm.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/admin/oauth/[provider]/start">,
): Promise<NextResponse> {
  try {
    const { provider } = await ctx.params;
    if (!isOAuthProviderId(provider)) {
      return NextResponse.json(
        { success: false, error: "VALIDATION_ERROR", message: "Unknown provider." },
        { status: 400 },
      );
    }

    const { authorizationUrl, sealed } = await beginOAuth(provider, "admin", request);

    const store = await cookies();
    store.set(STATE_COOKIE, sealed, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/admin/oauth",
      maxAge: STATE_TTL_SECONDS,
    });

    return NextResponse.redirect(authorizationUrl);
  } catch {
    return NextResponse.redirect(
      new URL("/admin/login?error=oauth_unavailable", request.url),
    );
  }
}
