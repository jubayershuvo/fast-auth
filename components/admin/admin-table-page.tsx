import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

import { EmptyState } from "@/components/ui";
import { TableScroll } from "@/components/ui/table-scroll";
import { cn } from "@/lib/cn";

/**
 * Shared chrome for the admin list pages: a heading, a search form, a
 * horizontally scrollable table, and pagination.
 *
 * Pagination is link-based (rather than client-side) so every page is
 * server-rendered from a real URL and can be bookmarked / shared.
 */
export function AdminTablePage({
  title,
  description,
  total,
  page,
  limit,
  search,
  searchPlaceholder,
  columns,
  rows,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  extraParams = {},
  header,
}: {
  title: string;
  description: string;
  total: number;
  page: number;
  limit: number;
  search?: string;
  searchPlaceholder: string;
  columns: string[];
  rows: ReactNode;
  emptyTitle: string;
  emptyDescription?: string;
  emptyIcon?: React.ComponentProps<typeof EmptyState>["icon"];
  extraParams?: Record<string, string | undefined>;
  header?: ReactNode;
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const buildHref = (target: number) => {
    const params = new URLSearchParams();
    params.set("page", String(target));
    params.set("limit", String(limit));
    if (search) params.set("search", search);
    for (const [key, value] of Object.entries(extraParams)) {
      if (value) params.set(key, value);
    }
    return `?${params.toString()}`;
  };

  return (
    <div className="mx-auto max-w-7xl px-5 py-7 sm:px-7 lg:px-9">
      <div className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {description}
            <span className="tnum ml-2 text-ink-subtle">{total} total</span>
          </p>
        </div>
        {header}
      </div>

      <form className="mt-5 flex max-w-sm items-center gap-2" method="get">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
          <input
            name="search"
            defaultValue={search ?? ""}
            placeholder={searchPlaceholder}
            className="input pl-8"
            aria-label={searchPlaceholder}
          />
        </div>
        <button type="submit" className="btn btn-md btn-secondary">
          Search
        </button>
        {search ? (
          <Link href="?" className="btn btn-md btn-ghost">
            Clear
          </Link>
        ) : null}
      </form>

      {total === 0 ? (
        <div className="card mt-4">
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            icon={emptyIcon}
          />
        </div>
      ) : (
        <div className="card mt-4 overflow-hidden">
          <TableScroll label={emptyTitle}>
            <table className="w-full min-w-[760px]">
              <thead className="border-b border-line bg-surface-850">
                <tr>
                  {columns.map((column) => (
                    <th key={column} className="table-head">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">{rows}</tbody>
            </table>
          </TableScroll>
        </div>
      )}

      {totalPages > 1 ? (
        <nav className="mt-4 flex items-center justify-between" aria-label="Pagination">
          <p className="tnum text-[12px] text-ink-muted">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Link
              href={buildHref(Math.max(1, page - 1))}
              aria-disabled={page <= 1}
              className={cn(
                "btn btn-sm btn-secondary",
                page <= 1 && "pointer-events-none opacity-40",
              )}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </Link>
            <Link
              href={buildHref(Math.min(totalPages, page + 1))}
              aria-disabled={page >= totalPages}
              className={cn(
                "btn btn-sm btn-secondary",
                page >= totalPages && "pointer-events-none opacity-40",
              )}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
