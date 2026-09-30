import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { beginOAuth, STATE_COOKIE, STATE_TTL_SECONDS } from "@/lib/oauth-flow";
import { isOAuthProviderId } from "@/lib/oauth-providers";

/**
 * GET /api/auth/oauth/:provider/start?next=/dashboard
 *
 * Kicks off the customer OAuth flow. Issues a PKCE verifier + state and
 * redirects to the provider. The verifier and state are sealed into an
 * httpOnly cookie, never into the URL.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/auth/oauth/[provider]/start">,
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

    // `next` is ignored on purpose: the post-login destination is carried
    // inside the sealed state cookie, never in a URL, so it cannot be used as
    // an open redirect.
    void url.searchParams.get("next");

    const { authorizationUrl, sealed } = await beginOAuth(provider, "customer", request);

    const store = await cookies();
    store.set(STATE_COOKIE, sealed, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      // `lax` (not `strict`): the cookie must survive the provider's
      // top-level redirect back to our callback.
      sameSite: "lax",
      path: "/api/auth/oauth",
      maxAge: STATE_TTL_SECONDS,
    });

    return NextResponse.redirect(authorizationUrl);
  } catch {
    // A browser flow must never land on a raw JSON error page: send the user
    // back to sign-in with a generic code (no provider internals leaked).
    return NextResponse.redirect(
      new URL("/login?error=oauth_unavailable", request.url),
    );
  }
}
