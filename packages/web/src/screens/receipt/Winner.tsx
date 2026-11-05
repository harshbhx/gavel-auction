import { t } from '../../copy/t';
import type { HoldView } from '../../ladder/ladderModel';
import { formatUsd } from '../../util/money';

export interface WinnerProps {
  hold: HoldView;
  itemName: string;
  /** The price the hammer fell at. */
  priceCents: number;
  /** Epoch ms shown on the receipt. */
  at: number;
}

/** True only once the winning hold is in the CAPTURED state or later. */
export function isCaptured(hold: HoldView): boolean {
  return (hold.state === 'CAPTURED' || hold.state === 'SETTLED') && hold.capturedCents > 0;
}

/** Winner receipt (R-WEB-095). The word "Charged" appears only after CAPTURED; before that the amount is held. */
export function Winner({ hold, itemName, priceCents, at }: WinnerProps) {
  const captured = isCaptured(hold);
  return (
    <section className="gv-receipt__body">
      <dl className="gv-receipt__rows">
        <dt>{t('receipt.item')}</dt>
        <dd>{itemName}</dd>
        <dt>{t('receipt.winningPrice')}</dt>
        <dd>{formatUsd(priceCents)}</dd>
        <dt>{t('receipt.time')}</dt>
        <dd>
          <time dateTime={new Date(at).toISOString()}>{new Date(at).toISOString()}</time>
        </dd>
      </dl>
      {captured ? (
        <>
          <p className="gv-receipt__status">
            {t('receipt.charged', { amount: formatUsd(hold.capturedCents) })}
          </p>
          <p>{t('receipt.reference', { suffix: hold.idSuffix })}</p>
        </>
      ) : (
        <>
          <p className="gv-receipt__status" role="status" aria-busy="true">
            {t('receipt.capturing')}
          </p>
          <progress aria-label={t('receipt.capturing')} />
          <p>{t('receipt.heldNotCharged', { amount: formatUsd(priceCents) })}</p>
        </>
      )}
    </section>
  );
}
