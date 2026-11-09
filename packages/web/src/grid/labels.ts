import type { CopyKey } from '../copy/en';
import { t } from '../copy/t';
import type { IconName } from '../design/icons';
import type { ChipTone } from '../design/primitives/Chip';
import type { ChainStatus } from './ledgerModel';

const TYPE_KEYS = {
  auction_opened: 'ledger.type.auction_opened',
  hold_placed: 'ledger.type.hold_placed',
  bid_accepted: 'ledger.type.bid_accepted',
  bid_rejected: 'ledger.type.bid_rejected',
  hammer: 'ledger.type.hammer',
  winner_settled: 'ledger.type.winner_settled',
  hold_released: 'ledger.type.hold_released',
  audit_accepted: 'ledger.type.audit_accepted',
  audit_rejected: 'ledger.type.audit_rejected',
  audit_expired: 'ledger.type.audit_expired',
  audit_superseded: 'ledger.type.audit_superseded',
} as const satisfies Record<string, CopyKey>;

function isTypeKey(type: string): type is keyof typeof TYPE_KEYS {
  return Object.prototype.hasOwnProperty.call(TYPE_KEYS, type);
}

/** Words for an entry type; an unknown type shows its machine name rather than nothing. */
export function typeLabel(type: string): string {
  return isTypeKey(type) ? t(TYPE_KEYS[type]) : type;
}

export function typeTone(type: string): ChipTone {
  if (type.endsWith('rejected')) return 'danger';
  if (type === 'hammer' || type === 'winner_settled') return 'accent';
  if (type.endsWith('accepted')) return 'success';
  return 'neutral';
}

/** Words for who did it. */
export function actorLabel(actor: string | null): string {
  if (actor === null) return '';
  if (actor === 'auctioneer') return t('ledger.actor.auctioneer');
  if (actor === 'system') return t('ledger.actor.system');
  if (actor.startsWith('paddle:')) return t('ledger.actor.paddle', { n: actor.slice(7) });
  return actor;
}

export const STATUS_LABEL: Readonly<Record<ChainStatus, () => string>> = {
  verified: () => t('ledger.status.verified'),
  tampered: () => t('ledger.status.tampered'),
  broken: () => t('ledger.status.broken'),
  unsealed: () => t('ledger.status.unsealed'),
};

export const STATUS_TONE: Readonly<Record<ChainStatus, ChipTone>> = {
  verified: 'success',
  tampered: 'danger',
  broken: 'danger',
  unsealed: 'neutral',
};

export const STATUS_ICON: Readonly<Record<ChainStatus, IconName>> = {
  verified: 'lock',
  tampered: 'stop',
  broken: 'warning',
  unsealed: 'hollow',
};
