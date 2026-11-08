import { t } from '../../copy/t';
import type { CopyKey } from '../../copy/en';
import type { AuctionStatus } from '../../wire';

export interface ConsoleGuideProps {
  readonly status: AuctionStatus;
  readonly stopped: boolean;
  readonly roomId: string | null;
}

type StateKey = Extract<CopyKey, `console.guide.state.${string}`>;
type NextKey = Extract<CopyKey, `console.guide.next.${string}`>;

const STATE: Readonly<Record<AuctionStatus, StateKey>> = {
  SCHEDULED: 'console.guide.state.scheduled',
  OPEN: 'console.guide.state.open',
  PAUSED: 'console.guide.state.paused',
  CLOSING: 'console.guide.state.closing',
  SETTLING: 'console.guide.state.settling',
  DONE: 'console.guide.state.done',
};

const NEXT: Readonly<Record<AuctionStatus, NextKey>> = {
  SCHEDULED: 'console.guide.next.scheduled',
  OPEN: 'console.guide.next.open',
  PAUSED: 'console.guide.next.paused',
  CLOSING: 'console.guide.next.closing',
  SETTLING: 'console.guide.next.settling',
  DONE: 'console.guide.next.done',
};

/** Plain-language status for the lot and the one thing to do next, plus where the audit trail lives. */
export function ConsoleGuide({ status, stopped, roomId }: ConsoleGuideProps) {
  const stateKey: StateKey = stopped ? 'console.guide.state.stopped' : STATE[status];
  const nextKey: NextKey = stopped ? 'console.guide.next.stopped' : NEXT[status];
  return (
    <section className="gv-console-guide" aria-label={t('console.guide.title')}>
      <p className="gv-console-guide__state" data-status={stopped ? 'STOPPED' : status}>
        <span className="ui-kicker">{t('console.guide.title')}</span>
        <strong>{t(stateKey)}</strong>
      </p>
      <p className="gv-console-guide__next">{t(nextKey)}</p>
      <p className="gv-console-guide__audit">
        {t('console.guide.audit')}{' '}
        {roomId !== null && (
          <a href={`/r/${encodeURIComponent(roomId)}/audit`}>{t('console.guide.auditLink')}</a>
        )}
      </p>
    </section>
  );
}
