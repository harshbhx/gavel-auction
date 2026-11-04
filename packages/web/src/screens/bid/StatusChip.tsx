import type { ReactNode } from 'react';

import { t } from '../../copy/t';
import { Icon, type IconName } from '../../design/icons';
import { Chip, type ChipTone } from '../../design/primitives/Chip';
import type { MyStatus } from '../../store/selectors';

export type ChipStatus = MyStatus | 'pending';

/**
 * Pure: the chip value for this bidder (R-WEB-054). A bid that was sent and not yet answered
 * shows as pending unless the bidder already won or lost.
 */
export function myStatus(base: MyStatus, bidPending: boolean): ChipStatus {
  if (!bidPending) return base;
  return base === 'won' || base === 'lost' || base === 'review' || base === 'watching'
    ? base
    : 'pending';
}

interface ChipView {
  label: string;
  icon: IconName;
  tone: ChipTone;
}

function viewOf(status: ChipStatus): ChipView {
  switch (status) {
    case 'leading':
      return { label: t('bid.status.leading'), icon: 'current', tone: 'success' };
    case 'outbid':
      return { label: t('bid.status.outbid'), icon: 'warning', tone: 'warning' };
    case 'none':
      return { label: t('bid.status.none'), icon: 'hollow', tone: 'neutral' };
    case 'pending':
      return { label: t('bid.status.pending'), icon: 'clock', tone: 'accent' };
    case 'atCeiling':
      return { label: t('bid.status.atCeiling'), icon: 'lock', tone: 'warning' };
    case 'won':
      return { label: t('bid.status.won'), icon: 'check', tone: 'success' };
    case 'lost':
      return { label: t('bid.status.lost'), icon: 'stop', tone: 'danger' };
    case 'review':
      return { label: t('ladder.state.FAILED_NEEDS_REVIEW'), icon: 'warning', tone: 'danger' };
    case 'watching':
      return { label: t('bid.status.watching'), icon: 'hand', tone: 'neutral' };
  }
}

export interface StatusChipProps {
  status: ChipStatus;
}

/** Own status chip: always an icon and text (R-WEB-054). */
export function StatusChip({ status }: StatusChipProps): ReactNode {
  const view = viewOf(status);
  return (
    <Chip state={status} label={view.label} icon={<Icon name={view.icon} />} tone={view.tone} />
  );
}
