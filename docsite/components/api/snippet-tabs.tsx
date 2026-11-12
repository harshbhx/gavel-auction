'use client';

import { useState } from 'react';
import type { Sample } from './snippets';

// Language tabs for a request sample. A tab choice is kept for the visit only.
export function SnippetTabs({ samples, label }: { samples: Sample[]; label: string }) {
  const [id, setId] = useState(samples[0]?.id);
  const [copied, setCopied] = useState(false);
  const cur = samples.find((s) => s.id === id) ?? samples[0];
  if (!cur) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cur.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the text can still be selected */
    }
  };
  return (
    <div className="border border-fd-border bg-fd-card">
      <div className="flex items-center justify-between gap-2 border-b border-fd-border px-2">
        <div role="tablist" aria-label={`${label} request sample language`} className="flex overflow-x-auto">
          {samples.map((s) => (
            <button
              key={s.id}
              role="tab"
              type="button"
              aria-selected={s.id === cur.id}
              onClick={() => setId(s.id)}
              className={`px-3 py-2 text-xs font-semibold whitespace-nowrap ${
                s.id === cur.id ? 'border-b-2 border-fd-foreground' : 'text-fd-muted-foreground'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={copy} className="px-2 py-1 text-xs font-semibold underline underline-offset-2" aria-live="polite">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed" tabIndex={0}>
        <code>{cur.code}</code>
      </pre>
    </div>
  );
}
