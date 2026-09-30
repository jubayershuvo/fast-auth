/** Tiny class-name joiner. Avoids pulling in a dependency for 3 lines. */
export function cn(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}

/** Absolute date, e.g. "30 Oct 2026". */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** Absolute date + time, for log tables. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Relative time, e.g. "3 days ago". Falls back to an absolute date. */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return "Never";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["second", 1000],
    ["minute", 60_000],
    ["hour", 3_600_000],
    ["day", 86_400_000],
    ["month", 2_592_000_000],
    ["year", 31_536_000_000],
  ];

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  let chosen: [Intl.RelativeTimeFormatUnit, number] = units[0];
  for (const unit of units) {
    if (abs >= unit[1]) chosen = unit;
  }
  return rtf.format(Math.round(diffMs / chosen[1]), chosen[0]);
}

/** Human label for an expiration value. */
export function describeExpiration(expiresAt: string | null): string {
  if (!expiresAt) return "Lifetime";
  const expiry = new Date(expiresAt);
  if (expiry.getTime() <= Date.now()) return `Expired ${formatRelative(expiresAt)}`;
  return formatDate(expiresAt);
}
