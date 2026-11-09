import { type ComponentProps } from 'react';

import { t } from '../copy/t';
import { ChunkBoundary, lazyWithRetry } from '../screens/states/ChunkBoundary';
import './grid.css';

/**
 * The grids are lazy: AG Grid (its own lazy chunks) is fetched only when a page that shows a table
 * opens, so the landing and bidder bundles do not carry it (the size gate checks that).
 */
const LedgerGridLazy = lazyWithRetry(() => import('./LedgerGrid'));
const BidsGridLazy = lazyWithRetry(() => import('./BidsGrid'));
const HoldsGridLazy = lazyWithRetry(() => import('./HoldsGrid'));

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
    <ChunkBoundary
      fallback={<GridFallback {...(props.height === undefined ? {} : { height: props.height })} />}
    >
      <LedgerGridLazy {...props} />
    </ChunkBoundary>
  );
}

export function BidsGrid(props: ComponentProps<typeof BidsGridLazy>) {
  return (
    <ChunkBoundary
      fallback={<GridFallback {...(props.height === undefined ? {} : { height: props.height })} />}
    >
      <BidsGridLazy {...props} />
    </ChunkBoundary>
  );
}

export function HoldsGrid(props: ComponentProps<typeof HoldsGridLazy>) {
  return (
    <ChunkBoundary
      fallback={<GridFallback {...(props.height === undefined ? {} : { height: props.height })} />}
    >
      <HoldsGridLazy {...props} />
    </ChunkBoundary>
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
