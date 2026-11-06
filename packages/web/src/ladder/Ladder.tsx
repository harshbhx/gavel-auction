import { t } from '../copy/t';
import { Icon } from '../design/icons';
import { formatUsd } from '../util/money';
import { RemainderNote } from './RemainderNote';
import {
  buildLadder,
  type LadderLane,
  type Rung,
  type SettlementView,
  type Verification,
} from './ladderModel';
import './ladder.css';

export interface LadderProps {
  /** Latest settlement view for the lot, or null before the first settlement update. */
  view: SettlementView | null;
  /**
   * 'all' (default) also prints the invariant, branch and totals notes. 'lanes' leaves them to
   * the caller, which mounts InvariantBanner and Branches itself.
   */
  parts?: 'all' | 'lanes';
  /** False hides the confirmation line of each lane (no per-hold data was sent, so none is pending). */
  verification?: boolean;
}

function clock(at: number): string {
  return new Date(at).toISOString().slice(11, 19);
}

function verificationText(v: Verification): string {
  switch (v.kind) {
    case 'webhook':
      return t('ladder.verify.webhook', { type: v.eventType ?? '', time: clock(v.at) });
    case 'lookup':
      return t('ladder.verify.lookup', { time: clock(v.at) });
    case 'pending':
      return t('ladder.verify.pending');
  }
}

function RungItem({ rung, canSayReleased }: { rung: Rung; canSayReleased: boolean }) {
  // The word "released" appears only once the server reports the hold as released.
  const hideLabel = rung.state === 'SETTLED' && !canSayReleased;
  const label = hideLabel ? t('ladder.waiting') : t(`ladder.state.${rung.state}`);
  const icon = rung.status === 'done' ? 'check' : rung.status === 'current' ? 'current' : 'hollow';
  return (
    <li
      className="gv-ladder__rung"
      data-state={rung.state}
      data-status={rung.status}
      aria-current={rung.status === 'current' ? 'step' : undefined}
    >
      <span className="gv-ladder__icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <span className="gv-ladder__label">{label}</span>
    </li>
  );
}

function Lane({ lane, verification }: { lane: LadderLane; verification: boolean }) {
  const showCaptured = lane.state === 'CAPTURED' && lane.capturedCents > 0;
  return (
    <li className="gv-ladder__lane" data-paddle={lane.paddle} data-winner={lane.isWinner}>
      <div className="gv-ladder__who">
        <span className="gv-ladder__paddle tabular" aria-label={t('reg.paddle')}>
          {lane.paddle}
        </span>
        <span className="gv-ladder__name">{lane.name}</span>
        <span className="gv-ladder__money tabular">{formatUsd(lane.ceilingCents)}</span>
        {showCaptured && (
          <span className="gv-ladder__money tabular" data-kind="captured">
            {t('ladder.state.CAPTURED')} {formatUsd(lane.capturedCents)}
          </span>
        )}
        {lane.canSayReleased && lane.releasedCents > 0 && (
          <span className="gv-ladder__money tabular" data-kind="released">
            {t('ladder.state.SETTLED')} {formatUsd(lane.releasedCents)}
          </span>
        )}
        {lane.remainder !== null ? (
          <RemainderNote remainder={lane.remainder} className="gv-ladder__note" />
        ) : (
          lane.remainderVoided && (
            <span className="gv-ladder__note">{t('ladder.remainderVoided')}</span>
          )
        )}
      </div>
      <ol className="gv-ladder__rungs">
        {lane.rungs.map((rung) => (
          <RungItem key={rung.state} rung={rung} canSayReleased={lane.canSayReleased} />
        ))}
      </ol>
      {verification && (
        <p className="gv-ladder__verify" data-verification={lane.verification.kind}>
          {verificationText(lane.verification)}
        </p>
      )}
    </li>
  );
}

/** Settlement ladder: one lane per hold, a table on wide screens and a stepper on phones. */
export function Ladder({ view, parts = 'all', verification = true }: LadderProps) {
  const model = buildLadder(view);
  const notes = parts === 'all';
  const inv = model.invariants;
  return (
    <section className="gv-ladder" aria-labelledby="gv-ladder-title">
      <h2 id="gv-ladder-title">{t('ladder.title')}</h2>
      {model.waiting && (
        <>
          <p role="status">{t('ladder.waiting')}</p>
          <ol className="gv-ladder__rungs" data-skeleton="true">
            {model.skeleton.map((rung) => (
              <RungItem key={rung.state} rung={rung} canSayReleased={false} />
            ))}
          </ol>
        </>
      )}
      {notes && inv !== null && inv.violated && (
        <p role="alert" className="gv-ladder__banner" data-tone="danger">
          <Icon name="warning" />
          {t('ladder.invariants.bad')}
        </p>
      )}
      {notes && model.fallback !== null && (
        <p className="gv-ladder__note" data-kind="fallback">
          {t('ladder.fallback', {
            reason: model.fallback.reason ?? '',
            n: model.fallback.runnerUpPaddle ?? '',
          })}
        </p>
      )}
      {notes && model.failed !== null && (
        <p className="gv-ladder__note" data-kind="failed">
          {t('ladder.failed')}
        </p>
      )}
      <ul className="gv-ladder__lanes">
        {model.lanes.map((lane) => (
          <Lane key={lane.paddle} lane={lane} verification={verification} />
        ))}
      </ul>
      {notes &&
        inv !== null &&
        !inv.unreported &&
        !inv.violated &&
        inv.totalsMatch &&
        view?.phase === 'SETTLED' && (
          <p className="gv-ladder__note" data-kind="totals">
            {t('ladder.invariants.ok', {
              c: formatUsd(inv.capturedCents),
              r: formatUsd(inv.releasedCents),
              h: formatUsd(inv.holdsCents),
            })}
          </p>
        )}
    </section>
  );
}
