import type { ReactNode } from 'react';
import './primitives.css';

export type ChipTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export interface ChipProps {
  /** Machine state, for example a ladder state or bid status. Exposed as data-state. */
  state: string;
  /** Visible text. State is never carried by colour alone (R-WEB-016). */
  label: string;
  /** Decorative icon shown next to the label. */
  icon: ReactNode;
  tone?: ChipTone;
}

/** Always renders an icon and a text label together. */
export function Chip({ state, label, icon, tone = 'neutral' }: ChipProps) {
  return (
    <span className="gv-chip" data-state={state} data-tone={tone}>
      <span className="gv-chip__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="gv-chip__label">{label}</span>
    </span>
  );
}
