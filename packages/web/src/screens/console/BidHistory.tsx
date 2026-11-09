import { useState } from 'react';

import { t } from '../../copy/t';
import { BidsGrid } from '../../grid';
import { BidStream, type BidStreamRow } from './BidStream';

/** The bid history as the plain list (default) or as the AG Grid table, one switch apart. */
export function BidHistory({ rows, roomId }: { rows: readonly BidStreamRow[]; roomId: string }) {
  const [view, setView] = useState<'list' | 'grid'>('list');
  return (
    <>
      <div className="gv-views" role="group" aria-label={t('console.view.label')}>
        {(['list', 'grid'] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => {
              setView(v);
            }}
          >
            {t(v === 'list' ? 'console.view.list' : 'console.view.grid')}
          </button>
        ))}
      </div>
      {view === 'grid' ? <BidsGrid rows={rows} roomId={roomId} /> : <BidStream rows={rows} />}
    </>
  );
}
