import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

// One entry of the changelog timeline: a rail on the left, a square marker and a mono date label.
// Day entries use a solid marker, "open" (unreleased work) a hatched one, notes a hollow one.
// The markers differ in fill as well as colour, and every entry carries its label as text.
export function ChangelogDay({
  label,
  kind = 'day',
  children,
}: {
  label: string;
  kind?: 'day' | 'open' | 'note';
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        'hl-changelog relative my-8 border-l-2 border-[var(--hl-border)] pb-2 pl-6',
        '[&>h2]:mt-2 [&>h3]:mt-5 [&>h3]:font-mono [&>h3]:text-[0.72rem] [&>h3]:font-bold [&>h3]:uppercase [&>h3]:tracking-wide [&>h3]:text-fd-muted-foreground',
        '[&>ul]:my-2',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute -left-[9px] top-1.5 block h-4 w-4 border-2 border-[var(--hl-border)]',
          kind === 'day' && 'bg-[var(--hl-signal)]',
          kind === 'open' && 'hl-hatch-fill bg-[var(--hl-panel)]',
          kind === 'note' && 'bg-[var(--hl-panel)]',
        )}
      />
      <p className="m-0 inline-block rounded-[2px] border border-[var(--hl-border)] bg-[var(--hl-panel)] px-1.5 font-mono text-[0.72rem] font-bold uppercase leading-5 tracking-wide">
        {label}
      </p>
      {children}
    </section>
  );
}
