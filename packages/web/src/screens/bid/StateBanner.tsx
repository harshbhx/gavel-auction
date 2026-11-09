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

/** Copy key of the banner shown for this state, or null when bidding is open. */
export function bidsNotice(
  status: string | null,
  stopped = false,
): 'bid.stoppedBanner' | 'bid.paused' | 'bid.closedBanner' | 'bid.notOpenYet' | null {
  if (stopped) return 'bid.stoppedBanner';
  if (status === 'PAUSED') return 'bid.paused';
  if (status === 'SCHEDULED') return 'bid.notOpenYet';
  if (status === 'CLOSING' || status === 'SETTLING' || status === 'DONE') return 'bid.closedBanner';
  return null;
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
  if (status === 'SCHEDULED') {
    return (
      <Banner tone="info" icon={<Icon name="pause" />}>
        {t('bid.notOpenYet')}
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
