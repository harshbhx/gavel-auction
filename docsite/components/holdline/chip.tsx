import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { gateById } from '@/lib/repo-data';

const base =
  'inline-block rounded-[2px] px-1.5 py-px align-middle font-mono text-[0.68rem] font-bold uppercase leading-5 tracking-wide';

/** Mono chip, for example FAKE PAYPAL or SANDBOX on a code block that differs between the two. */
export function Chip({
  kind = 'hollow',
  children,
}: {
  kind?: 'fake' | 'sandbox' | 'hatched' | 'solid' | 'hollow' | 'stop';
  children: ReactNode;
}) {
  const style =
    kind === 'fake' || kind === 'hatched'
      ? 'hl-hatch-chip'
      : kind === 'sandbox' || kind === 'solid'
        ? 'hl-solid-chip'
        : kind === 'stop'
          ? 'hl-stop-chip'
          : 'hl-hollow-chip';
  return <span className={cn(base, style)}>{children}</span>;
}

/** Status of one gate, read from docs/GATES.md at build time, with its fill and a word. */
export function GateBadge({ id }: { id: string }) {
  const g = gateById(id);
  const inProgress = g.id === 'G3' && g.status === 'NOT RUN';
  const label = inProgress ? 'IN PROGRESS' : g.status;
  const kind = g.status === 'PASS' ? 'solid' : g.status === 'FAIL' ? 'stop' : inProgress || g.status === 'PARTIAL' ? 'hatched' : 'hollow';
  return <Chip kind={kind}>{`${g.id} ${label}`}</Chip>;
}
