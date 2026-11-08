import type { ReactNode } from 'react';

import { t } from '../../copy/t';
import { formatUsd } from '../../util/money';
import type { AuditPayload } from '../../wire';
import type { Names } from './trailText';
import { whoLabel } from './trailText';

/** What the page hands to whatever renders the ledger (the AG Grid LedgerGrid, UIX-35). */
export interface LedgerSlotProps {
  /** Rows after the page filters, in seq order. */
  rows: readonly AuditPayload[];
  /** Every row the room holds, before filters. */
  allRows: readonly AuditPayload[];
  paddleOf: (bidderId: string) => number | null;
  names: Names;
  /** True when filters narrowed the rows. */
  filtered: boolean;
  /** True while the room can still add rows. */
  live: boolean;
  /** Open the page's detail sheet for a row. The sheet, its keyboard handling and prev / next belong to the page. */
  onOpen: (row: AuditPayload) => void;
  /** The row whose detail sheet is open, or null. */
  selected: AuditPayload | null;
}

export type LedgerRender = (props: LedgerSlotProps) => ReactNode;

/** Tiny accessible fallback shown in the ledger slot until a grid is plugged in. */
export function LedgerFallback({ rows, filtered, paddleOf, names, onOpen }: LedgerSlotProps) {
  if (rows.length === 0) {
    return (
      <p className="gv-state gv-state--empty" role="status">
        {t(filtered ? 'audit.noMatch' : 'audit.empty')}
      </p>
    );
  }
  return (
    <div className="gv-audit-ledger">
      <div
        className="gv-audit-ledger__scroll"
        role="region"
        aria-label={t('audit.ledger.scroll')}
        tabIndex={0}
      >
        <table>
          <caption className="gv-audit__sr">{t('audit.ledger.title')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('audit.col.seq')}</th>
              <th scope="col">{t('audit.col.serverTs')}</th>
              <th scope="col">{t('audit.col.paddle')}</th>
              <th scope="col">{t('audit.col.parsedAmount')}</th>
              <th scope="col">{t('audit.col.outcome')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.seq} data-outcome={row.outcome}>
                <th scope="row">
                  <button
                    type="button"
                    aria-label={t('audit.drawer.title', { seq: row.seq })}
                    onClick={() => onOpen(row)}
                  >
                    {row.seq}
                  </button>
                </th>
                <td>{new Date(Number(row.serverTs)).toISOString().slice(11, 23)}</td>
                <td>{whoLabel(paddleOf(row.bidderId), names)}</td>
                <td>{row.parsedAmount === undefined ? '' : formatUsd(Number(row.parsedAmount))}</td>
                <td>{t(`audit.outcome.${row.outcome}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
