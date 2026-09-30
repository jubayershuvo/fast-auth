/**
 * Reduce an address to something safe to show back on screen.
 *
 * The reset screen says WHERE the code went, so the person does not go hunting
 * through five inboxes. That is worth doing — but only with most of the
 * address hidden, and only ever for the address the caller just supplied or
 * one the server has already proved belongs to the account being recovered.
 *
 * Shape: keep the first two characters of the local part, the domain's first
 * character, and the TLD.
 *
 *   fastmail@company.com        -> f*******@c***.com
 *   a@b.co                       -> a*@b**.co
 *
 * Short inputs are masked entirely rather than revealing a single character,
 * which for a two-character local part would otherwise be the whole thing.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) {
    // Not an address at all (a username, or junk): mask it like a word so the
    // caller never sees an unrecognisable string rendered as if it were an email.
    if (email.length <= 2) return "*".repeat(Math.max(email.length, 1));
    return `${email.slice(0, 1)}${"*".repeat(email.length - 1)}`;
  }

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");

  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  const hiddenLocal = "*".repeat(Math.max(local.length - visible.length, 1));

  if (dot <= 0) return `${visible}${hiddenLocal}@${domain.slice(0, 1)}***`;

  const name = domain.slice(0, dot);
  const tld = domain.slice(dot + 1);
  return `${visible}${hiddenLocal}@${name.slice(0, 1)}***.${tld}`;
}
