import { ShieldCheck, Cookie, KeyRound, Globe, KeySquare } from "lucide-react";

import { CodeBlock } from "@/components/docs/code-block";
import { cn } from "@/lib/cn";
import type { EndpointDoc } from "@/lib/api-docs/types";

const METHOD_STYLES: Record<string, string> = {
  GET: "bg-info-900/60 text-info-400 border-info-500/30",
  POST: "bg-success-900/60 text-success-400 border-success-500/30",
  PATCH: "bg-warn-900/60 text-warn-400 border-warn-500/30",
  PUT: "bg-warn-900/60 text-warn-400 border-warn-500/30",
  DELETE: "bg-danger-900/60 text-danger-400 border-danger-500/30",
};

const AUTH_LABEL: Record<EndpointDoc["auth"], { label: string; icon: typeof Globe }> = {
  none: { label: "Public", icon: Globe },
  bearer: { label: "Bearer token", icon: KeyRound },
  cookie: { label: "Customer cookie", icon: Cookie },
  "admin-cookie": { label: "Operator cookie", icon: ShieldCheck },
  "portal-cookie": { label: "End-user cookie", icon: Cookie },
  "api-key": { label: "API key", icon: KeySquare },
};

export function MethodBadge({ method }: { method: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-[52px] shrink-0 justify-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold",
        METHOD_STYLES[method] ?? METHOD_STYLES.GET,
      )}
    >
      {method}
    </span>
  );
}

function AuthBadge({ auth }: { auth: EndpointDoc["auth"] }) {
  const { label, icon: Icon } = AUTH_LABEL[auth];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-subtle">
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function ParamTable({ endpoint }: { endpoint: EndpointDoc }) {
  const params = endpoint.params ?? [];
  if (params.length === 0) return null;

  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[520px] text-left">
        <thead className="border-b border-line bg-surface-850">
          <tr>
            <th className="table-head">Name</th>
            <th className="table-head">In</th>
            <th className="table-head">Type</th>
            <th className="table-head">Description</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {params.map((param) => (
            <tr key={`${param.in}-${param.name}`}>
              <td className="table-cell whitespace-nowrap font-mono text-[12px]">
                {param.name}
                {param.required ? <span className="ml-1 text-danger-400">*</span> : null}
              </td>
              <td className="table-cell whitespace-nowrap text-[12px] text-ink-subtle">
                {param.in}
              </td>
              <td className="table-cell whitespace-nowrap text-[12px] text-ink-subtle">
                {param.type}
              </td>
              <td className="table-cell text-[13px] text-ink-muted">
                {param.description}
                {param.example ? (
                  <span className="mt-0.5 block font-mono text-[11px] text-ink-subtle">
                    e.g. {param.example}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One endpoint, fully expanded with parameters and examples. */
export function EndpointCard({ endpoint }: { endpoint: EndpointDoc }) {
  return (
    <article id={endpoint.id} className="relative scroll-mt-24 border-t border-line py-6">
      <header className="flex flex-wrap items-center gap-3">
        <MethodBadge method={endpoint.method} />
        <code className="font-mono text-[13px] text-ink">{endpoint.path}</code>
        <AuthBadge auth={endpoint.auth} />
      </header>

      <h3 className="mt-2.5 text-[15px] font-semibold text-ink">{endpoint.title}</h3>
      <p className="mt-1 text-[13px] text-ink-muted">{endpoint.summary}</p>

      {endpoint.notes?.map((note) => (
        <p
          key={note}
          className="mt-3 rounded-lg border border-line bg-surface-850 px-3 py-2 text-[13px] text-ink-muted"
        >
          {note}
        </p>
      ))}

      <ParamTable endpoint={endpoint} />

      {endpoint.requestExample ? (
        <div className="mt-4">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
            Request
          </p>
          <CodeBlock code={endpoint.requestExample.code} lang={endpoint.requestExample.lang} />
        </div>
      ) : null}

      {endpoint.responseExample ? (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
            Response
          </p>
          <CodeBlock code={endpoint.responseExample.code} lang={endpoint.responseExample.lang} />
        </div>
      ) : null}

      {endpoint.errors && endpoint.errors.length > 0 ? (
        <div className="mt-4">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
            Errors
          </p>
          <ul className="space-y-1">
            {endpoint.errors.map((error) => (
              <li key={`${error.status}-${error.code}`} className="flex gap-2.5 text-[13px]">
                <span className="tnum w-9 shrink-0 font-mono text-[12px] text-danger-400">
                  {error.status}
                </span>
                <span className="font-mono text-[12px] text-ink">{error.code}</span>
                <span className="text-ink-muted">{error.when}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

/** Compact one-line summary, used for secondary endpoints. */
export function EndpointRow({ endpoint }: { endpoint: EndpointDoc }) {
  return (
    <a
      href={`#${endpoint.id}`}
      id={endpoint.id}
      className="flex scroll-mt-24 flex-col gap-1 border-t border-line px-1 py-3 transition-colors first:border-t-0 hover:bg-surface-850/50 sm:flex-row sm:items-center sm:gap-3"
    >
      <MethodBadge method={endpoint.method} />
      <code className="font-mono text-[12px] text-ink-muted">{endpoint.path}</code>
      <span className="text-[13px] text-ink-subtle sm:ml-auto sm:text-right">
        {endpoint.title}
      </span>
    </a>
  );
}

