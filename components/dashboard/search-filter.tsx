import { Search, X } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * Search box that navigates by GET, so it needs no client JavaScript.
 *
 * A form targeting the current path keeps the filter in the URL, which means it
 * survives a refresh, is shareable, and works with the browser's back button.
 * Filtering in the database (not in JS after fetching) is what keeps pagination
 * totals honest — a client-side filter would say "12 results" on page 4 of 40.
 */
export function SearchFilter({
  action,
  search,
  placeholder,
  /** Extra query params to preserve while searching (e.g. userId). */
  hidden = {},
  className,
}: {
  /** Path this form submits to — normally the current page. */
  action: string;
  /** Current term, echoed back into the field. */
  search?: string;
  placeholder: string;
  hidden?: Record<string, string | undefined>;
  className?: string;
}) {
  const hasQuery = Boolean(search);

  return (
    <form
      action={action}
      method="get"
      role="search"
      className={cn("flex items-center gap-2", className)}
    >
      {Object.entries(hidden).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}

      <div className="relative flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
        />
        <input
          type="search"
          name="search"
          defaultValue={search ?? ""}
          placeholder={placeholder}
          aria-label={placeholder}
          className="input pl-9"
        />
      </div>

      <button type="submit" className="btn btn-md btn-secondary">
        Search
      </button>

      {/*
        Without this, filtering then navigating back leaves the term in the box
        and the results still filtered, which reads as a broken app.
      */}
      {hasQuery ? (
        <a href={action} className="btn btn-md btn-ghost">
          <X className="h-4 w-4" />
          Clear
        </a>
      ) : null}
    </form>
  );
}
