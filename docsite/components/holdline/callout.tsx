import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

// Four asides replace note/tip/warning. Each has a text prefix, so the meaning never rests on
// colour alone: Held = pending or unverified, Charged = confirmed and verified,
// Released = undone or retired, Not verified = proven only against the fake PayPal or a simulation.
function Aside({
  kind,
  label,
  title,
  children,
}: {
  kind: 'held' | 'charged' | 'released' | 'review';
  label: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <aside className={cn('hl-callout', `hl-callout--${kind}`)} aria-label={title ?? label}>
      <p className="hl-callout__label">{title ? `${label}: ${title}` : label}</p>
      <div className="text-[0.95rem] [&>p]:my-2">{children}</div>
    </aside>
  );
}

export function Held({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Aside kind="held" label="Held" title={title}>
      {children}
    </Aside>
  );
}

export function Charged({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Aside kind="charged" label="Charged" title={title}>
      {children}
    </Aside>
  );
}

export function Released({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Aside kind="released" label="Released" title={title}>
      {children}
    </Aside>
  );
}

export function NotVerified({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Aside kind="review" label="Not verified" title={title}>
      {children}
    </Aside>
  );
}
