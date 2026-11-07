'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Maximize2, X } from 'lucide-react';

// One figure: the SVG, a caption that carries the honesty statement, a text transcript in a
// <details> (accessible and searchable) and a full-size view for phones. The SVG is rendered
// by `render`, which receives an id prefix so the full-size copy does not reuse ids.
export function DiagramFrame({
  title,
  desc,
  width,
  height,
  minWidth = 880,
  badge,
  caption,
  transcript,
  render,
}: {
  title: string;
  desc: string;
  width: number;
  height: number;
  minWidth?: number;
  badge?: ReactNode;
  caption: ReactNode;
  transcript: ReactNode;
  render: (idPrefix: string) => ReactNode;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const svg = (prefix: string, min: number) => (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-labelledby={`${prefix}-title ${prefix}-desc`}
      className="dg block h-auto w-full"
      style={{ minWidth: min }}
    >
      <title id={`${prefix}-title`}>{title}</title>
      <desc id={`${prefix}-desc`}>{desc}</desc>
      {render(prefix)}
    </svg>
  );

  return (
    <figure className="not-prose my-8 border border-[var(--hl-hairline)] bg-fd-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--hl-hairline)] px-3 py-2">
        <p className="font-mono text-[0.7rem] font-bold tracking-wide uppercase">{title}</p>
        <div className="flex items-center gap-2">
          {badge}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-[2px] border px-2 py-1 font-mono text-[0.68rem] font-bold uppercase hover:bg-fd-accent"
          >
            <Maximize2 className="size-3.5" aria-hidden />
            Open full size
          </button>
        </div>
      </div>
      <div className="fd-scroll-container overflow-x-auto" role="region" aria-label={`${title}, scrollable`} tabIndex={0}>
        {svg(uid, minWidth)}
      </div>
      <figcaption className="border-t border-[var(--hl-hairline)] px-3 py-3 text-sm">{caption}</figcaption>
      <details className="border-t border-[var(--hl-hairline)] px-3 py-2 text-sm">
        <summary className="cursor-pointer font-mono text-[0.7rem] font-bold uppercase">Text version of this diagram</summary>
        <div className="mt-2 space-y-2 [&_li]:my-1 [&_ol]:list-decimal [&_ol]:ps-5 [&_ul]:list-disc [&_ul]:ps-5">{transcript}</div>
      </details>
      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        aria-label={`${title}, full size`}
        className="m-0 h-dvh max-h-none w-dvw max-w-none border-0 bg-[var(--hl-bg)] p-0 text-[var(--hl-fg)] backdrop:bg-black/70"
      >
        {open && (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-[var(--hl-hairline)] px-3 py-2">
              <p className="font-mono text-[0.7rem] font-bold uppercase">{title}</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                autoFocus
                className="inline-flex items-center gap-1.5 rounded-[2px] border px-2 py-1 font-mono text-[0.68rem] font-bold uppercase hover:bg-fd-accent"
              >
                <X className="size-4" aria-hidden />
                Close
              </button>
            </div>
            <div className="flex-1 overflow-auto p-3">{svg(`${uid}full`, width)}</div>
          </div>
        )}
      </dialog>
    </figure>
  );
}
