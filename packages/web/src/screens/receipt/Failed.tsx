import type { ReactNode } from 'react';

import { t } from '../../copy/t';
import { formatUsd } from '../../util/money';

export interface FailedProps {
  /** True when we cannot say whether a capture went through; false when none was attempted for this person. */
  uncertain: boolean;
  /** Reference id suffix (last 6 characters only). */
  reference: string;
  /** Hammer price in cents, for the winner's own receipt only. */
  priceCents?: number | null;
  /** Organizer contact slot. */
  contact?: ReactNode;
}

/** Receipt for FAILED_NEEDS_REVIEW (R-WEB-098). It never reads as a charge. */
export function Failed({ uncertain, reference, contact, priceCents = null }: FailedProps) {
  return (
    <section className="gv-receipt__body" data-outcome="review" role="alert">
      <p className="gv-receipt__status">
        {uncertain ? t('receipt.failed') : t('receipt.failedNoCapture')}
      </p>
      {uncertain && priceCents !== null && (
        <p className="gv-receipt__status">
          {t('receipt.failedWon', { amount: formatUsd(priceCents) })}
        </p>
      )}
      <dl className="gv-receipt__rows">
        <dt>{t('receipt.contact')}</dt>
        <dd>{contact ?? t('receipt.contactMissing')}</dd>
        <dt>{t('receipt.referenceId')}</dt>
        <dd>{reference}</dd>
      </dl>
    </section>
  );
}
