import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api-response";
import { completeOAuth, STATE_COOKIE } from "@/lib/oauth-flow";
import { isOAuthProviderId } from "@/lib/oauth-providers";
import { resolveCustomerIdentity } from "@/lib/oauth-user";
import { createSession } from "@/lib/session";
import { getRequestContext } from "@/lib/request";
import { connectToDatabase } from "@/lib/mongodb";
import { UserModel } from "@/models/User";

/**
 * GET /api/auth/oauth/:provider/callback
 *
 * Completes the customer flow, resolves/creates the local account and starts a
 * normal dashboard session. The same session mechanism as password login, so
 * every downstream authorisation rule applies unchanged.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/auth/oauth/[provider]/callback">,
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

    const providerError = url.searchParams.get("error");
    if (providerError) {
      // The user declined, or the provider refused. Not a server fault.
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(providerError)}`, url.origin),
      );
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      throw new Error("Missing code or state");
    }

    const store = await cookies();
    const sealed = store.get(STATE_COOKIE)?.value;
    // Single-use: clear it whether or not the exchange succeeds.
    store.set(STATE_COOKIE, "", { path: "/api/auth/oauth", maxAge: 0 });
    if (!sealed) {
      return NextResponse.redirect(new URL("/login?error=state_expired", url.origin));
    }

    const profile = await completeOAuth({
      provider,
      realm: "customer",
      code,
      returnedState: state,
      sealed,
      request,
    });

    const identity = await resolveCustomerIdentity(provider, profile);

    const { ip, userAgent } = getRequestContext(request);
    await connectToDatabase();
    await UserModel.updateOne(
      { _id: identity.id },
      { $set: { lastLoginAt: new Date(), lastLoginIp: ip } },
    ).catch(() => undefined);
    await createSession(identity.id, { ip, userAgent });

    const next = url.searchParams.get("next");
    const destination =
      next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

    return NextResponse.redirect(new URL(destination, url.origin));
  } catch (error) {
    handleApiError(error);
    // Never leak provider internals into the URL the user sees.
    return NextResponse.redirect(new URL("/login?error=oauth_failed", url.origin));
  }
}
