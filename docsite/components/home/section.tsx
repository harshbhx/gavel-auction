import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Section({
  children,
  className,
  id,
  labelledBy,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  labelledBy?: string;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={cn('px-4 py-14 md:py-20', className)}>
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </section>
  );
}

export function SectionHeading({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-8 max-w-3xl md:mb-12">
      <p className="hl-eyebrow">{eyebrow}</p>
      <h2 id={id} className="hl-display mt-2 text-4xl md:text-5xl">
        {title}
      </h2>
      {children && <p className="mt-4 text-fd-muted-foreground md:text-lg">{children}</p>}
    </header>
  );
}

export const btnPrimary =
  'inline-flex items-center gap-2 rounded-[2px] border-2 border-[var(--hl-fg)] bg-[var(--hl-signal)] px-4 py-2.5 text-sm font-bold text-[var(--hl-on-signal)] shadow-[3px_3px_0_var(--hl-shadow)] transition-transform hover:-translate-x-px hover:-translate-y-px';
export const btnSecondary =
  'inline-flex items-center gap-2 rounded-[2px] border-2 border-[var(--hl-fg)] bg-[var(--hl-panel)] px-4 py-2.5 text-sm font-bold shadow-[3px_3px_0_var(--hl-shadow)] transition-transform hover:-translate-x-px hover:-translate-y-px';
