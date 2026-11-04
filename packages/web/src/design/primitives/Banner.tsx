import type { ReactNode } from 'react';
import './primitives.css';

export type BannerTone = 'info' | 'warn' | 'danger';

export interface BannerProps {
  readonly tone: BannerTone;
  readonly icon: ReactNode;
  readonly children: ReactNode;
}

export function Banner({ tone, icon, children }: BannerProps) {
  return (
    <div className="gv-banner" data-tone={tone} role="status">
      <span className="gv-banner__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="gv-banner__text">{children}</span>
    </div>
  );
}
