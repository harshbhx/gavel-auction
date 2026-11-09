import { lazy, Suspense, type ComponentProps } from 'react';

import { t } from '../copy/t';
import './grid.css';

/**
 * The grids are lazy: AG Grid (its own lazy chunks) is fetched only when a page that shows a table
 * opens, so the landing and bidder bundles do not carry it (the size gate checks that).
 */
const LedgerGridLazy = lazy(() => import('./LedgerGrid'));
const BidsGridLazy = lazy(() => import('./BidsGrid'));
const HoldsGridLazy = lazy(() => import('./HoldsGrid'));

/** Holds the table's place while the chunk loads, at the height the grid will have, so nothing jumps. */
export function GridFallback({ height }: { height?: number }) {
  return (
    <div
      className="gv-gridbox gv-gridbox--loading"
      role="status"
      style={height === undefined ? undefined : { height }}
    >
      {t('grid.loading')}
    </div>
  );
}

export function LedgerGrid(props: ComponentProps<typeof LedgerGridLazy>) {
  return (
    <Suspense
      fallback={<GridFallback {...(props.height === undefined ? {} : { height: props.height })} />}
    >
      <LedgerGridLazy {...props} />
    </Suspense>
  );
}

export function BidsGrid(props: ComponentProps<typeof BidsGridLazy>) {
  return (
    <Suspense
      fallback={<GridFallback {...(props.height === undefined ? {} : { height: props.height })} />}
    >
      <BidsGridLazy {...props} />
    </Suspense>
  );
}

export function HoldsGrid(props: ComponentProps<typeof HoldsGridLazy>) {
  return (
    <Suspense
      fallback={<GridFallback {...(props.height === undefined ? {} : { height: props.height })} />}
    >
      <HoldsGridLazy {...props} />
    </Suspense>
  );
}

/** The honest credit: a short note with a link, shown wherever the tables appear. */
export function BuiltWithAgGrid() {
  return (
    <p className="gv-gridnote">
      {t('grid.note.lead')}
      <a href="https://www.ag-grid.com/" target="_blank" rel="noreferrer noopener">
        {t('grid.note.link')}
      </a>
      {t('grid.note.tail')}
    </p>
  );
}
