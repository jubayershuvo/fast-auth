import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

export const metadata: Metadata = { title: "Sign-in methods" };

/**
 * Social sign-in moved onto /admin/settings/auth-methods, so that ONE page
 * answers "how do people sign in here, and what does each method need?".
 *
 * This route is kept as a permanent redirect rather than deleted: an operator
 * with the old URL bookmarked, or a runbook that links to it, should land on
 * the new page instead of a 404. `permanentRedirect` (308) preserves the method
 * for non-GET callers, and search engines drop the duplicate.
 */
export default function AdminOauthSettingsPage(): never {
  permanentRedirect("/admin/settings/auth-methods");
}

