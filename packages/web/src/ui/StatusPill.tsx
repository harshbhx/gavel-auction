import type { ReactNode } from 'react';

export type PillTone = 'neutral' | 'held' | 'win' | 'out' | 'live';

export interface StatusPillProps {
  tone?: PillTone;
  children: ReactNode;
}

/** A short status label. Colour is never the only signal: the text says the status. */
export function StatusPill({ tone = 'neutral', children }: StatusPillProps) {
  return (
    <span className="ui-pill" data-tone={tone}>
      <i className="ui-pill__mark" aria-hidden="true" />
      {children}
    </span>
  );
}
