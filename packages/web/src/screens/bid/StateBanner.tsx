import { t } from '../../copy/t';
import { Icon } from '../../design/icons';
import { Banner } from '../../design/primitives/Banner';

export interface StateBannerProps {
  /** Auction status from the room snapshot, or null before the first state. */
  status: string | null;
  /** The room was stopped by the operator. */
  stopped?: boolean;
}

/** True when bid controls must be disabled for this status (R-WEB-062). */
export function bidsLocked(status: string | null, stopped = false): boolean {
  return stopped || status !== 'OPEN';
}

/** Banner that explains why bidding is off: paused, lot closed or auction stopped. */
export function StateBanner({ status, stopped = false }: StateBannerProps) {
  if (stopped) {
    return (
      <Banner tone="warn" icon={<Icon name="stop" />}>
        {t('bid.stoppedBanner')}
      </Banner>
    );
  }
  if (status === 'PAUSED') {
    return (
      <Banner tone="warn" icon={<Icon name="pause" />}>
        {t('bid.paused')}
      </Banner>
    );
  }
  if (status === 'CLOSING' || status === 'SETTLING' || status === 'DONE') {
    return (
      <Banner tone="info" icon={<Icon name="stop" />}>
        {t('bid.closedBanner')}
      </Banner>
    );
  }
  return null;
}
