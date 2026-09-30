export default function DashboardLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-brand-500" />
        <p className="text-[13px] text-ink-muted">Loading…</p>
      </div>
    </div>
  );
}
