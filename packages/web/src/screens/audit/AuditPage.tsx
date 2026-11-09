import { useMemo, useState, type ReactNode } from 'react';

import { t } from '../../copy/t';
import type { RoomState } from '../../store/roomReducer';
import type { AuditPayload } from '../../wire';
import { Empty, Loading, Offline } from '../states/States';
import { useOnline } from '../states/useOnline';
import { AuditDrawer } from './AuditDrawer';
import { AuditSummary } from './AuditSummary';
import { AuditTimeline } from './AuditTimeline';
import { CopyActions } from './CopyActions';
import { Export } from './Export';
import { LedgerFallback, type LedgerRender } from './LedgerSlot';
import { Filters, useUrlFilters } from './Filters';
import { applyFilters, applyTrailFilters, hasActiveFilters } from './filters';
import { buildTrail, paddleLookup, summarize } from './trail';
import type { Names } from './trailText';
import './audit.css';

export interface AuditPageProps {
  state: RoomState;
  roomId: string;
  /**
   * Slot for the hash chain verdict (the ChainCheck component). It sits beside the summary, so a
   * judge sees the chain status with the result. Absent: the summary and the guide use the width.
   */
  chain?: ReactNode;
  /**
   * Slot for the ledger table (named LedgerSlot). The AG Grid LedgerGrid plugs in here and gets
   * the filtered rows, names and an `onOpen` that opens the page's detail sheet. Absent: a tiny
   * accessible fallback table.
   */
  ledger?: LedgerRender;
  /** Slot for the reviewer area (key link and verify steps), under the guide. */
  reviewer?: ReactNode;
}

const STEPS = [
  'audit.intro.step1',
  'audit.intro.step2',
  'audit.intro.step3',
  'audit.intro.step4',
] as const;

function Guide() {
  return (
    <section className="gv-audit-guide" aria-labelledby="gv-audit-guide-title">
      <h2 id="gv-audit-guide-title">{t('audit.intro.title')}</h2>
      <p>{t('audit.intro.body')}</p>
      <ol>
        {STEPS.map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ol>
    </section>
  );
}

/** The audit trail page: guide, summary, chain slot, timeline and ledger under shared filters. */
export function AuditPage({
  state,
  roomId,
  chain,
  reviewer,
  ledger = LedgerFallback,
}: AuditPageProps) {
  const online = useOnline();
  const [filters, setFilters] = useUrlFilters();
  const [open, setOpen] = useState<AuditPayload | null>(null);
  const loaded = state.snapshot !== null;
  const rows = state.audit;
  const paddleOf = useMemo(() => paddleLookup(state), [state]);
  const names = useMemo<Names>(() => {
    const roster = state.snapshot?.roster ?? [];
    return { nameOf: (p) => roster.find((r) => r.paddle === p)?.name ?? null };
  }, [state.snapshot]);
  const trail = useMemo(() => buildTrail(state), [state]);
  const summary = useMemo(() => summarize(state), [state]);
  const latestAt = rows.reduce((m, r) => Math.max(m, Number(r.serverTs)), 0);
  const filteredRows = applyFilters(rows, filters, paddleOf);
  const filteredTrail = applyTrailFilters(trail, filters, latestAt);
  const active = hasActiveFilters(filters);
  const hasAnything = rows.length > 0 || trail.length > 0;
  const idx = open === null ? -1 : filteredRows.findIndex((r) => r.seq === open.seq);
  const base = `/r/${encodeURIComponent(roomId)}`;

  return (
    <main data-route="audit" className="gv-audit">
      <header className="gv-audit__head">
        <h1 tabIndex={-1}>{t('audit.title')}</h1>
        <p>{t('audit.sub')}</p>
      </header>
      {!online && <Offline view="audit" />}
      {!loaded ? (
        <Loading view="audit" />
      ) : !hasAnything ? (
        <>
          <Guide />
          <Empty view="audit" />
        </>
      ) : (
        <>
          <div className="gv-audit__top" data-chain={chain === undefined ? 'absent' : 'present'}>
            <AuditSummary summary={summary} />
            {chain !== undefined && <div className="gv-audit__chain">{chain}</div>}
          </div>
          <div
            className="gv-audit__guide-row"
            data-reviewer={reviewer === undefined ? 'absent' : 'present'}
          >
            <Guide />
            {reviewer !== undefined && <div className="gv-audit__reviewer">{reviewer}</div>}
          </div>
          {state.auditTruncated && (
            <p className="gv-state gv-state--offline" role="status">
              {t('audit.truncated')}
            </p>
          )}
          <div className="gv-audit__bar">
            <Filters filters={filters} onChange={setFilters} />
            <p className="gv-audit__count" role="status">
              {t('audit.filter.summary', { shown: filteredTrail.length, total: trail.length })}
            </p>
            <div className="gv-audit__actions" role="group" aria-label={t('audit.actions')}>
              <CopyActions
                entries={filteredTrail}
                names={names}
                title={summary.lotTitle ?? t('audit.title')}
                href={() => window.location.href}
              />
              <Export
                roomId={roomId}
                lotId={roomId}
                filteredRows={filteredRows}
                allRows={rows}
                paddleOf={paddleOf}
                truncated={state.auditTruncated}
              />
            </div>
          </div>
          <div className="gv-audit__panels">
            <AuditTimeline
              entries={filteredTrail}
              filtered={active && trail.length > 0}
              names={names}
              onOpen={setOpen}
              receiptHref={`${base}/receipt`}
            />
            <section
              className="gv-audit-panel gv-audit-ledgerpanel"
              aria-labelledby="gv-audit-ledger-title"
            >
              <header>
                <h2 id="gv-audit-ledger-title">{t('audit.ledger.title')}</h2>
                <p>{t('audit.ledger.lead')}</p>
              </header>
              <div className="gv-audit__ledger-slot" data-slot="ledger">
                {ledger({
                  roomId,
                  rows: filteredRows,
                  allRows: rows,
                  paddleOf,
                  names,
                  filtered: active && rows.length > 0,
                  live: ['scheduled', 'open', 'paused'].includes(summary.status),
                  onOpen: setOpen,
                  selected: open,
                })}
              </div>
            </section>
          </div>
          <AuditDrawer
            row={open}
            onClose={() => setOpen(null)}
            paddleOf={paddleOf}
            names={names}
            onPrev={idx > 0 ? () => setOpen(filteredRows[idx - 1] ?? null) : undefined}
            onNext={
              idx >= 0 && idx < filteredRows.length - 1
                ? () => setOpen(filteredRows[idx + 1] ?? null)
                : undefined
            }
          />
        </>
      )}
    </main>
  );
}
