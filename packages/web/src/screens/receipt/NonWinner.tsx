import { t } from '../../copy/t';
import type { HoldView } from '../../ladder/ladderModel';
import { formatUsd } from '../../util/money';

export interface NonWinnerProps {
  hold: HoldView;
  itemName: string;
  at: number;
}

/** True only once the hold has been voided and released. */
export function isReleased(hold: HoldView): boolean {
  return hold.state === 'SETTLED';
}

/** Non-winner receipt (R-WEB-096). "Hold was released" shows only after the void; before that the hold is shown as held. */
export function NonWinner({ hold, itemName, at }: NonWinnerProps) {
  const released = isReleased(hold);
  const amount = formatUsd(
    released && hold.releasedCents > 0 ? hold.releasedCents : hold.ceilingCents,
  );
  return (
    <section className="gv-receipt__body">
      <dl className="gv-receipt__rows">
        <dt>{t('receipt.item')}</dt>
        <dd>{itemName}</dd>
        <dt>{t('receipt.time')}</dt>
        <dd>
          <time dateTime={new Date(at).toISOString()}>{new Date(at).toISOString()}</time>
        </dd>
      </dl>
      {released ? (
        <p className="gv-receipt__status">{t('receipt.released', { amount })}</p>
      ) : (
        <>
          <p className="gv-receipt__status" role="status" aria-busy="true">
            {t('receipt.releasing')}
          </p>
          <p>{t('receipt.heldNotCharged', { amount })}</p>
        </>
      )}
    </section>
  );
}
