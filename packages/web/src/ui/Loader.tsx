import type { CSSProperties, ReactNode } from 'react';

export interface LoaderProps {
  /** Text for assistive technology and the visible caption. */
  label?: string;
}

/** A small busy indicator with a text label. The spin stops under reduced motion. */
export function Loader({ label = 'Loading' }: LoaderProps) {
  return (
    <span className="ui-loader" role="status" aria-live="polite">
      <span className="ui-loader__dot" aria-hidden="true" />
      <span className="ui-loader__label">{label}</span>
    </span>
  );
}

export interface SkeletonProps {
  /** CSS width, such as "70%" or "12rem". Default full width. */
  width?: string;
  /** CSS height. Default one line. */
  height?: string;
  circle?: boolean;
}

/** A placeholder block. Decorative: wrap a group in <SkeletonGroup> to announce loading once. */
export function Skeleton({ width, height, circle = false }: SkeletonProps) {
  const style: CSSProperties = {};
  if (width !== undefined) style.width = width;
  if (height !== undefined) style.height = height;
  return (
    <span
      className={circle ? 'ui-skeleton ui-skeleton--circle' : 'ui-skeleton'}
      style={style}
      aria-hidden="true"
    />
  );
}

export interface SkeletonGroupProps {
  label?: string;
  children: ReactNode;
}

/** Marks a group of skeletons as busy and gives it one accessible name. */
export function SkeletonGroup({ label = 'Loading', children }: SkeletonGroupProps) {
  return (
    <div className="ui-skeleton-group" role="status" aria-busy="true" aria-label={label}>
      {children}
    </div>
  );
}
