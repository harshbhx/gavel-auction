/** Instructor: the buttons each screen's one-time guide explains. Copy lives in en.ts. */
import type { CopyKey } from '../copy/en';
import type { AuctionStatus } from '../wire';

export type InstructorScreen =
  | 'hub'
  | 'console'
  | 'bid'
  | 'receipt'
  | 'verify'
  | 'try'
  | 'register';

export interface GuideButton {
  readonly name: CopyKey;
  readonly text: CopyKey;
}

const buttons = (screen: InstructorScreen, count: number): readonly GuideButton[] =>
  Array.from({ length: count }, (_, i) => ({
    name: `instructor.${screen}.${i + 1}.name` as CopyKey,
    text: `instructor.${screen}.${i + 1}.text` as CopyKey,
  }));

export const INSTRUCTOR_BUTTONS: Readonly<Record<InstructorScreen, readonly GuideButton[]>> = {
  console: buttons('console', 5),
  bid: buttons('bid', 5),
  hub: buttons('hub', 6),
  try: buttons('try', 4),
  receipt: buttons('receipt', 3),
  verify: buttons('verify', 4),
  register: buttons('register', 3),
};

export interface RoomFacts {
  readonly status: AuctionStatus | null;
  /** The lot was stopped, sold or settled: nothing more happens in this room. */
  readonly ended: boolean;
}

/** Where the room is, for screens that still report it. The guide itself does not use it. */
export function hubStep({ status, ended }: RoomFacts): number {
  if (ended) return 4;
  if (status === 'OPEN' || status === 'PAUSED' || status === 'CLOSING') return 3;
  return 0;
}

export function consoleStep({ status, ended }: RoomFacts): number {
  if (ended) return 3;
  if (status === 'OPEN' || status === 'PAUSED') return 1;
  if (status === 'CLOSING') return 2;
  return 0;
}

export interface BidderFacts extends RoomFacts {
  /** The bidder has a hold, so a limit is already set. */
  readonly hasLimit: boolean;
}

export function bidderStep({ status, ended, hasLimit }: BidderFacts): number {
  if (ended) return 3;
  if (!hasLimit) return 0;
  return status === 'OPEN' ? 2 : 1;
}
