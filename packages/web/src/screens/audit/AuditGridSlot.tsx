import { useMemo, useState } from 'react';

import { t } from '../../copy/t';
import { BuiltWithAgGrid, LedgerGrid } from '../../grid';
import { entriesFromAudit } from '../../grid/ledgerModel';
import { LedgerFallback, type LedgerSlotProps } from './LedgerSlot';

/**
 * The audit page's ledger slot: the AG Grid LedgerGrid by default, the plain table one switch away.
 * A selected grid row opens the page's own detail sheet, so the grid's own panel is off here.
 */
function AuditLedger(props: LedgerSlotProps) {
  const [view, setView] = useState<'table' | 'grid'>('grid');
  const { rows, paddleOf, onOpen } = props;
  const entries = useMemo(() => entriesFromAudit(rows, paddleOf), [rows, paddleOf]);
  return (
    <>
      <div className="gv-views" role="group" aria-label={t('audit.view.label')}>
        {(['table', 'grid'] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => {
              setView(v);
            }}
          >
            {t(v === 'table' ? 'audit.view.table' : 'audit.view.grid')}
          </button>
        ))}
      </div>
      {view === 'grid' && rows.length > 0 ? (
        <LedgerGrid
          entries={entries}
          roomId={props.roomId}
          urlState
          detail={false}
          onOpenEntry={(seq) => {
            const row = rows.find((r) => r.seq === seq);
            if (row !== undefined) onOpen(row);
          }}
        />
      ) : (
        <LedgerFallback {...props} />
      )}
      <BuiltWithAgGrid />
    </>
  );
}

export function renderAuditLedger(props: LedgerSlotProps) {
  return <AuditLedger {...props} />;
}
