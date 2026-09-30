import { cn } from "@/lib/cn";

export type TrafficPoint = { date: string; successes: number; failures: number };

/**
 * Dependency-free bar chart for the daily login trend.
 * Plain divs keep the bundle small and avoid a charting library for two series.
 */
export function TrafficChart({ data }: { data: TrafficPoint[] }) {
  const max = Math.max(1, ...data.map((point) => point.successes + point.failures));

  if (data.every((point) => point.successes === 0 && point.failures === 0)) {
    return (
      <p className="py-8 text-center text-[13px] text-ink-muted">
        No authentication activity in this window.
      </p>
    );
  }

  return (
    <div>
      {/* Legend */}
      <div className="mb-3 flex items-center gap-4 text-[11px] text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-success-500" />
          Successful
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-danger-500" />
          Failed
        </span>
      </div>

      <div className="flex h-40 items-end gap-1.5" role="img" aria-label="Daily login traffic">
        {data.map((point) => {
          const total = point.successes + point.failures;
          const successPct = total === 0 ? 0 : (point.successes / total) * 100;
          return (
            <div key={point.date} className="group flex h-full flex-1 flex-col justify-end">
              <div
                className="flex w-full flex-col overflow-hidden rounded-sm bg-surface-800"
                style={{ height: `${Math.max(2, (total / max) * 100)}%` }}
                title={`${point.date}: ${point.successes} ok, ${point.failures} failed`}
              >
                <div
                  className="w-full bg-danger-500"
                  style={{ height: `${100 - successPct}%` }}
                />
                <div className="w-full flex-1 bg-success-500" />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex justify-between text-[10px] text-ink-subtle">
        <span>{data[0]?.date.slice(5)}</span>
        <span>{data[data.length - 1]?.date.slice(5)}</span>
      </div>

      {/* Peak summary */}
      <p className="mt-3 text-[12px] text-ink-subtle">
        Peak {max} attempt{max === 1 ? "" : "s"} in a day.
      </p>
    </div>
  );
}

/** Compact horizontal bar list, used for the "top X" panels. */
export function RankedBars({
  entries,
  tone = "danger",
}: {
  entries: Array<{ label: string; count: number }>;
  tone?: "danger" | "info";
}) {
  const max = Math.max(1, ...entries.map((entry) => entry.count));
  return (
    <ul className="space-y-2.5">
      {entries.map((entry) => (
        <li key={entry.label}>
          <div className="flex items-center justify-between text-[12px]">
            <span className="truncate text-ink">{entry.label}</span>
            <span className="tnum shrink-0 text-ink-muted">{entry.count}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-800">
            <div
              className={cn(
                "h-full rounded-full",
                tone === "danger" ? "bg-danger-500" : "bg-info-500",
              )}
              style={{ width: `${(entry.count / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
