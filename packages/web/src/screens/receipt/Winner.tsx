import { t } from '../../copy/t';
import type { HoldView } from '../../ladder/ladderModel';
import { formatUsd } from '../../util/money';

export interface WinnerProps {
  hold: HoldView;
  itemName: string;
  /** The price the hammer fell at; null when this is not the original winner's receipt. */
  priceCents: number | null;
  /** Server epoch ms of the settle event; null hides the row. */
  at: number | null;
}

/** True only once the winning hold is in the CAPTURED state or later. */
export function isCaptured(hold: HoldView): boolean {
  return (hold.state === 'CAPTURED' || hold.state === 'SETTLED') && hold.capturedCents > 0;
}

/** True once the saga is past capture but the server has not said how much was captured. */
export function isConfirming(hold: HoldView): boolean {
  return (hold.state === 'CAPTURED' || hold.state === 'SETTLED') && hold.capturedCents === 0;
}

/** Held is the ceiling, to be charged is the hammer price: two different amounts, never swapped. */
function heldLine(ceilingCents: number, priceCents: number | null): string {
  if (priceCents === null) return t('receipt.heldOwn', { amount: formatUsd(ceilingCents) });
  if (ceilingCents <= 0) return t('receipt.priceToCharge', { price: formatUsd(priceCents) });
  return t('receipt.heldNotCharged', {
    ceiling: formatUsd(ceilingCents),
    price: formatUsd(priceCents),
  });
}

/** Winner receipt (R-WEB-095). The word "Charged" appears only after CAPTURED; before that the amount is held. */
export function Winner({ hold, itemName, priceCents, at }: WinnerProps) {
  const captured = isCaptured(hold);
  const confirming = isConfirming(hold);
  return (
    <section className="gv-receipt__body">
      <dl className="gv-receipt__rows">
        <dt>{t('receipt.item')}</dt>
        <dd>{itemName}</dd>
        {priceCents !== null && (
          <>
            <dt>{t('receipt.winningPrice')}</dt>
            <dd>{formatUsd(priceCents)}</dd>
          </>
        )}
        {at !== null && (
          <>
            <dt>{t('receipt.time')}</dt>
            <dd>
              <time dateTime={new Date(at).toISOString()}>{new Date(at).toISOString()}</time>
            </dd>
          </>
        )}
      </dl>
      {captured ? (
        <>
          <p className="gv-receipt__status">
            {t('receipt.charged', { amount: formatUsd(hold.capturedCents) })}
          </p>
          {hold.idSuffix !== '' && <p>{t('receipt.reference', { suffix: hold.idSuffix })}</p>}
        </>
      ) : confirming ? (
        <>
          <p className="gv-receipt__status" role="status">
            {t('receipt.confirming')}
          </p>
          {priceCents !== null && (
            <p>{t('receipt.priceToCharge', { price: formatUsd(priceCents) })}</p>
          )}
        </>
      ) : (
        <>
          <p className="gv-receipt__status" role="status" aria-busy="true">
            {t('receipt.capturing')}
          </p>
          <progress aria-label={t('receipt.capturing')} />
          <p>{heldLine(hold.ceilingCents, priceCents)}</p>
        </>
      )}
    </section>
  );
}
