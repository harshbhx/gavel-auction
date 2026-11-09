import type { HTMLAttributes, ReactNode } from 'react';
import './primitives.css';

export interface ActionGroupProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode;
}

/**
 * The shared button group (UIX-45). Children keep their DOM order: primary (solid), secondary
 * (outline), then an optional tertiary `variant="text"` button. Phones stack them full width with
 * one gap; wide screens put the first two side by side at equal widths.
 */
export function ActionGroup({ className, children, ...rest }: ActionGroupProps) {
  const classes = ['gv-actions', className]
    .filter((c): c is string => c !== undefined && c !== '')
    .join(' ');
  return (
    <div {...rest} className={classes}>
      {children}
    </div>
  );
}
