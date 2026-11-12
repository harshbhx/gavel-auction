'use client';

import { useMemo, useState } from 'react';
import { MethodBadge } from './method-badge';

export type NavGroup = { tag: string; slug: string; ops: { id: string; method: string; path: string; summary: string }[] };

// Left navigation of the API reference: endpoints grouped by tag, with a filter box.
function Inner({ groups, extra }: { groups: NavGroup[]; extra: { href: string; label: string }[] }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return groups;
    return groups
      .map((g) => ({ ...g, ops: g.ops.filter((o) => `${o.method} ${o.path} ${o.summary} ${g.tag}`.toLowerCase().includes(n)) }))
      .filter((g) => g.ops.length > 0);
  }, [q, groups]);
  return (
    <div className="space-y-4 text-sm">
      <label className="block">
        <span className="sr-only">Filter endpoints</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter endpoints"
          className="w-full border border-fd-border bg-fd-background px-2 py-1.5 text-sm"
        />
      </label>
      {!q ? (
        <ul className="space-y-1">
          {extra.map((e) => (
            <li key={e.href}>
              <a className="hover:underline" href={e.href}>{e.label}</a>
            </li>
          ))}
        </ul>
      ) : null}
      {shown.length === 0 ? <p className="text-fd-muted-foreground">No endpoint matches.</p> : null}
      {shown.map((g) => (
        <div key={g.tag}>
          <p className="mb-1 font-bold">
            <a href={`#tag-${g.slug}`} className="hover:underline">{g.tag}</a>
          </p>
          <ul className="space-y-1">
            {g.ops.map((o) => (
              <li key={o.id}>
                <a href={`#${o.id}`} className="flex items-start gap-2 py-0.5 hover:underline">
                  <MethodBadge method={o.method} small />
                  <span className="min-w-0 break-words">{o.summary}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function ApiNav(props: { groups: NavGroup[]; extra: { href: string; label: string }[] }) {
  return (
    <>
      <details className="border border-fd-border p-3 lg:hidden">
        <summary className="cursor-pointer text-sm font-bold">Endpoints and sections</summary>
        <div className="mt-3">
          <Inner {...props} />
        </div>
      </details>
      <nav aria-label="API reference" className="sticky top-20 hidden max-h-[calc(100vh-6rem)] overflow-y-auto pr-2 lg:block">
        <Inner {...props} />
      </nav>
    </>
  );
}
