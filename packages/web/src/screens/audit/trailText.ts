import { t } from '../../copy/t';
import { formatUsd } from '../../util/money';
import type { TrailEntry } from './trail';
import { stateLabelKey } from './trail';

export interface Names {
  /** Display name for a paddle, or null when the room has none. */
  nameOf: (paddle: number) => string | null;
}

export function whoLabel(paddle: number | null | undefined, names: Names): string {
  if (paddle === null || paddle === undefined) return t('audit.whoUnknown');
  const name = names.nameOf(paddle);
  return name === null || name === ''
    ? t('audit.who', { paddle })
    : t('audit.whoNamed', { paddle, name });
}

function via(e: TrailEntry): string {
  switch (e.source) {
    case 'voice':
      return t('audit.via.voice');
    case 'qr':
      return t('audit.via.qr');
    default:
      return t('audit.via.manual');
  }
}

/** One timeline line in plain words. */
export function describeEntry(e: TrailEntry, names: Names): string {
  const who = whoLabel(e.paddle, names);
  const amount = e.amountCents === undefined ? null : formatUsd(e.amountCents);
  switch (e.kind) {
    case 'hold':
      return t('audit.tl.hold', { who });
    case 'bid':
      return amount === null
        ? t('audit.tl.bidNoAmount', { who, via: via(e) })
        : t('audit.tl.bid', { who, amount, via: via(e) });
    case 'outbid':
      return t('audit.tl.outbid', {
        who,
        other: whoLabel(e.otherPaddle, names),
        amount: amount ?? formatUsd(0),
      });
    case 'rejected':
      return amount === null
        ? t('audit.tl.rejectedNoAmount', { who })
        : t('audit.tl.rejected', { who, amount });
    case 'expired':
      return t('audit.tl.expired', { who });
    case 'superseded':
      return t('audit.tl.superseded', { who });
    case 'extend':
      return t('audit.tl.extend', {
        n: e.count ?? 1,
        time: new Date(e.endTs ?? 0).toISOString().slice(11, 19),
      });
    case 'pause':
      return t('audit.tl.pause');
    case 'stopped':
      return t('audit.tl.stopped');
    case 'hammer':
      return amount === null ? t('audit.tl.hammerNone') : t('audit.tl.hammer', { who, amount });
    case 'settlement':
      return t('audit.tl.settleLine', {
        state: t(stateLabelKey(e.state ?? 'HELD')),
        n: e.count ?? 0,
      });
    case 'receipt':
      return t('audit.tl.receipt');
  }
}

/** UTC clock time with seconds, or the words for a line with no recorded time. */
export function entryTime(e: TrailEntry): string {
  if (e.at !== null) return new Date(e.at).toISOString().slice(11, 19);
  if (e.kind === 'hold') return t('audit.tl.beforeBidding');
  return t('audit.tl.latest');
}
