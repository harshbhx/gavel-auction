import { t } from '../../copy/t';
import { RemainderNote } from '../../ladder/RemainderNote';
import type { RemainderState } from '../../wire';
import { formatUsd } from '../../util/money';

export interface FallbackProps {
  itemName: string;
  /** Final amount charged to the runner-up who became the winner. */
  chargedCents: number;
  idSuffix: string;
  at: number | null;
  /** The server's remainder state for this hold, when it sent one. */
  remainder?: RemainderState;
}

/** Receipt for a runner-up who became the winner after the first winner could not be charged (R-WEB-097). Show only after CAPTURED. */
export function Fallback({ itemName, chargedCents, idSuffix, at, remainder }: FallbackProps) {
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
      {remainder !== undefined && (
        <p data-testid="receipt-remainder">
          <RemainderNote remainder={remainder} />
        </p>
      )}
    </section>
  );
}
