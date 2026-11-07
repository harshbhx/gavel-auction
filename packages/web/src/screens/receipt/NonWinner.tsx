import { t } from '../../copy/t';
import type { HoldView } from '../../ladder/ladderModel';
import { HoldCard } from '../../ui';
import { formatUsd } from '../../util/money';

export interface NonWinnerProps {
  hold: HoldView;
  itemName: string;
  at: number | null;
}

/** True only once the hold has been voided and released. */
export function isReleased(hold: HoldView): boolean {
  return hold.state === 'SETTLED';
}

/** Non-winner receipt (R-WEB-096). "Hold was released" shows only after the void; before that the hold is shown as held. */
export function NonWinner({ hold, itemName, at }: NonWinnerProps) {
  // "Released" only once the server says so and no remainder is still pending.
  const released = isReleased(hold) && hold.remainder !== 'pending';
  const amount = formatUsd(hold.ceilingCents);
  return (
    <section className="gv-receipt__body" data-outcome={released ? 'released' : 'releasing'}>
      <dl className="gv-receipt__rows">
        <dt>{t('receipt.item')}</dt>
        <dd>{itemName}</dd>
        {at !== null && (
          <>
            <dt>{t('receipt.time')}</dt>
            <dd>
              <time dateTime={new Date(at).toISOString()}>{new Date(at).toISOString()}</time>
            </dd>
          </>
        )}
      </dl>
      {released ? (
        <p className="gv-receipt__status">
          {hold.releasedCents > 0
            ? t('receipt.released', { amount: formatUsd(hold.releasedCents) })
            : t('receipt.releasedNoAmount')}
        </p>
      ) : (
        <>
          <p className="gv-receipt__status" role="status" aria-busy="true">
            {t('receipt.releasing')}
          </p>
          <p>{t('receipt.heldOwn', { amount })}</p>
        </>
      )}
      <HoldCard
        state={released ? 'released' : 'held'}
        ceilingCents={released && hold.releasedCents > 0 ? hold.releasedCents : hold.ceilingCents}
      />
    </section>
  );
}
