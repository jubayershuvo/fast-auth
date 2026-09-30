import type { Metadata } from "next";

import { AuthMethodManager } from "@/components/admin/auth-method-manager";
import { OAuthProviderManager } from "@/components/admin/oauth-provider-manager";
import { PageHeader } from "@/components/ui";
import { requireAdminPage } from "@/lib/authorization";
import { listAuthMethodConfigs } from "@/lib/auth-method";
import { listProviderConfigs } from "@/lib/oauth-config";

export const metadata: Metadata = { title: "Sign-in methods" };

/**
 * THE page where the main administrator decides how people sign in.
 *
 * One screen, every method — email+password and every social provider — because
 * that is the question an operator is actually answering ("what can my customers
 * use, and what does each one need before I turn it on?"). Splitting them across
 * two pages meant the answer was never in one place, and it was easy to enable
 * the password method without noticing it depended on mail that was never
 * configured.
 *
 * Sections are ordered by how much they depend on something else: the password
 * method first (it needs SMTP), then the providers (each needs a client id and
 * secret from a third party).
 */
export default async function AdminAuthMethodsPage() {
  await requireAdminPage();
  // Both are read in parallel: they are independent queries, and the operator is
  // waiting on the whole page to render.
  const [[method], providers] = await Promise.all([
    listAuthMethodConfigs(),
    listProviderConfigs(),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-5 py-7 sm:px-7 lg:px-9">
      <PageHeader
        title="Sign-in methods"
        description="Control every way customers and operators can sign in, and what each method needs before it can be enabled."
      />

      <div className="mt-6 space-y-8">
        {/*
          No EmptyState branch here: this section is a first-party method that
          always exists, so an "empty" state would be a bug, not a state.
        */}
        {method ? <AuthMethodManager method={method} /> : null}

        {/*
          A heading rather than a second page header — the page already has one,
          and a second `PageHeader` would read as two unrelated screens.
        */}
        <section aria-labelledby="social-signin-heading">
          <h2
            id="social-signin-heading"
            className="text-[15px] font-semibold text-ink"
          >
            Social sign-in
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            Enable and configure the identity providers available to customers
            and operators. A provider that is off, or missing a client id or
            secret, never appears on a sign-in screen.
          </p>
          <div className="mt-4">
            {providers.length === 0 ? (
              <p className="rounded-lg border border-line bg-surface-900 p-3.5 text-[13px] text-ink-muted">
                No social providers are available on this build.
              </p>
            ) : (
              <OAuthProviderManager providers={providers} />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
