import type { CSSProperties } from 'react';
import { t } from '../../copy/t';
import { PriceRoll } from '../../ui';
import { Icon } from '../../design/icons';
import { Chip } from '../../design/primitives/Chip';
import { formatUsd } from '../../util/money';
import { useThrottledAnnounce } from './useThrottledAnnounce';

export type SoldOutcome =
  | { readonly kind: 'sold'; readonly paddle: number | null; readonly amountCents: number }
  | { readonly kind: 'passed' };

export interface SettleCounts {
  readonly captured: number;
  readonly released: number;
}

export interface SoldProps {
  readonly outcome: SoldOutcome;
  /** Set once settlement_update arrives. */
  readonly settlement?: SettleCounts | null;
  /** Settlement stopped for review: no sale is claimed and no capture count is shown. */
  readonly review?: boolean;
}

/** SOLD or Passed banner with a compact settlement summary (R-WEB-078). */
export function Sold({ outcome, settlement = null, review = false }: SoldProps) {
  return (
    <section data-testid="sold" className="gv-screen__sold" data-kind={outcome.kind}>
      <p className="gv-hammer-stamp gv-screen__stamp tabular" data-closed="true">
        {outcome.kind === 'passed'
          ? t('screen.passed')
          : review
            ? outcome.paddle === null
              ? t('screen.wonReviewUnknown', { amount: formatUsd(outcome.amountCents) })
              : t('screen.wonReview', { n: outcome.paddle, amount: formatUsd(outcome.amountCents) })
            : outcome.paddle === null
              ? t('screen.soldUnknown', { amount: formatUsd(outcome.amountCents) })
              : t('screen.sold', { n: outcome.paddle, amount: formatUsd(outcome.amountCents) })}
      </p>
      {review && outcome.kind === 'sold' && (
        <p className="gv-screen__settle" data-testid="settle-review" role="status">
          {t('screen.settleReview')}
        </p>
      )}
      {!review && settlement !== null && (
        <p className="gv-screen__settle tabular" data-testid="settle-summary">
          {t('screen.settleSummary', { c: settlement.captured, r: settlement.released })}
        </p>
      )}
    </section>
  );
}

const HIDDEN: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
};

export interface PriceFlashProps {
  readonly cents: number;
}

/** Price that flashes on change (240 ms, none under reduced motion) with a throttled polite live region. */
export function PriceFlash({ cents }: PriceFlashProps) {
  const text = formatUsd(cents);
  const spoken = useThrottledAnnounce(t('screen.priceAnnounce', { amount: text }));
  return (
    <>
      <p className="gv-screen__price tabular" data-testid="screen-price">
        <PriceRoll cents={cents} />
      </p>
      <p aria-live="polite" style={HIDDEN}>
        {spoken}
      </p>
    </>
  );
}

export interface FrozenChipProps {
  /** True while the connection is down: the last state stays on screen with this chip. */
  readonly disconnected: boolean;
}

export function FrozenChip({ disconnected }: FrozenChipProps) {
  if (!disconnected) return null;
  return (
    <span role="status" className="gv-screen__frozen">
      <Chip
        state="reconnecting"
        label={t('net.reconnecting')}
        icon={<Icon name="clock" />}
        tone="warning"
      />
    </span>
  );
}
