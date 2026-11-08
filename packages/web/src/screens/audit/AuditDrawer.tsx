import { useEffect, useState } from 'react';

import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { Sheet } from '../../design/primitives/Sheet';
import { canonicalJson, sha256Hex } from '../../util/hash';
import { formatUsd } from '../../util/money';
import type { AuditPayload } from '../../wire';
import { entryOfRow } from './trail';
import { describeEntry, type Names, whoLabel } from './trailText';

export interface AuditDrawerProps {
  /** The row to show, or null when the drawer is closed. */
  row: AuditPayload | null;
  onClose: () => void;
  /** Paddle for a bidder id, or null when unknown. */
  paddleOf?: (bidderId: string) => number | null;
  names?: Names;
  /** Step to the previous or next entry in the list the reader is looking at; absent at the ends. */
  onPrev?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
}

const NO_NAMES: Names = { nameOf: () => null };
const NO_PADDLE = (): number | null => null;

function Fingerprint({ row }: { row: AuditPayload }) {
  const [hash, setHash] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setHash(undefined);
    void sha256Hex(canonicalJson(row)).then((h) => {
      if (live) setHash(h);
    });
    return () => {
      live = false;
    };
  }, [row]);
  return (
    <>
      <dt>{t('audit.hash')}</dt>
      <dd>
        <code data-testid="audit-hash">
          {hash === undefined ? t('state.loading') : (hash ?? t('audit.export.hashUnavailable'))}
        </code>
        <small>{t('audit.drawer.hashHelp')}</small>
      </dd>
    </>
  );
}

/** Row detail: a plain sentence, every field in words, then the raw audit_event JSON as received. */
export function AuditDrawer({
  row,
  onClose,
  paddleOf = NO_PADDLE,
  names = NO_NAMES,
  onPrev,
  onNext,
}: AuditDrawerProps) {
  if (row === null) return null;
  const paddle = paddleOf(row.bidderId);
  const sentence = describeEntry(entryOfRow(row, paddle), names);
  return (
    <Sheet open onClose={onClose} title={t('audit.drawer.title', { seq: row.seq })}>
      <div className="gv-audit-drawer">
        <h2>{t('audit.drawer.title', { seq: row.seq })}</h2>
        <p className="gv-audit-drawer__sentence">{sentence}</p>
        <dl className="gv-audit-drawer__fields">
          <dt>{t('audit.col.serverTs')}</dt>
          <dd className="tabular">{new Date(Number(row.serverTs)).toISOString()}</dd>
          <dt>{t('audit.col.paddle')}</dt>
          <dd>{whoLabel(paddle, names)}</dd>
          <dt>{t('audit.col.source')}</dt>
          <dd>{t(`audit.source.${row.source}`)}</dd>
          <dt>{t('audit.col.parsedAmount')}</dt>
          <dd className="tabular">
            {row.parsedAmount === undefined ? '' : formatUsd(Number(row.parsedAmount))}
          </dd>
          <dt>{t('audit.col.outcome')}</dt>
          <dd>{t(`audit.outcome.${row.outcome}`)}</dd>
          {row.reason !== undefined && (
            <>
              <dt>{t('audit.col.reason')}</dt>
              <dd>{row.reason}</dd>
            </>
          )}
          {row.source === 'voice' ? (
            <>
              <dt>{t('audit.col.transcript')}</dt>
              <dd>{row.transcript ?? ''}</dd>
              <dt>{t('audit.col.confidence')}</dt>
              <dd className="tabular">
                {row.confidence === undefined ? '' : row.confidence.toFixed(2)}
              </dd>
            </>
          ) : (
            <>
              <dt>{t('audit.col.transcript')}</dt>
              <dd>{t('audit.drawer.noTranscript')}</dd>
            </>
          )}
          <dt>{t('audit.col.confirmed')}</dt>
          <dd>
            {row.confirmed === undefined
              ? t('audit.confirmed.auto')
              : row.confirmed
                ? t('audit.confirmed.yes')
                : t('audit.confirmed.no')}
          </dd>
          <Fingerprint row={row} />
        </dl>
        <details className="gv-audit-drawer__raw">
          <summary>{t('audit.drawer.raw')}</summary>
          <p>{t('audit.drawer.rawHelp')}</p>
          <pre data-testid="audit-json" tabIndex={0}>
            {JSON.stringify(row, null, 2)}
          </pre>
        </details>
        <div className="gv-audit-drawer__actions">
          <Button variant="outline" tone="neutral" disabled={onPrev === undefined} onClick={onPrev}>
            {t('audit.drawer.prev')}
          </Button>
          <Button variant="outline" tone="neutral" disabled={onNext === undefined} onClick={onNext}>
            {t('audit.drawer.next')}
          </Button>
          <Button onClick={onClose}>{t('generic.close')}</Button>
        </div>
      </div>
    </Sheet>
  );
}
