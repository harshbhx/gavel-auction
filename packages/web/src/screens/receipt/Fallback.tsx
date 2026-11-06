import { t } from '../../copy/t';
import { formatUsd } from '../../util/money';

export interface FallbackProps {
  itemName: string;
  /** Final amount charged to the runner-up who became the winner. */
  chargedCents: number;
  idSuffix: string;
  at: number | null;
}

/** Receipt for a runner-up who became the winner after the first winner could not be charged (R-WEB-097). Show only after CAPTURED. */
export function Fallback({ itemName, chargedCents, idSuffix, at }: FallbackProps) {
  return (
    <section className="gv-receipt__body">
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
      <p className="gv-receipt__status">
        {t('receipt.fallback', { amount: formatUsd(chargedCents) })}
      </p>
      {idSuffix !== '' && <p>{t('receipt.reference', { suffix: idSuffix })}</p>}
    </section>
  );
}
