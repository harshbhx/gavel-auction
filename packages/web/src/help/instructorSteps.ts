/** Instructor: which steps each judge screen shows and which one is current. Copy lives in en.ts. */
import type { CopyKey } from '../copy/en';
import type { AuctionStatus } from '../wire';

export type InstructorScreen = 'hub' | 'console' | 'bid' | 'receipt' | 'verify' | 'try';

type StepKey = Extract<CopyKey, `instructor.${InstructorScreen}.${number}`>;

export const INSTRUCTOR_STEPS: Readonly<Record<InstructorScreen, readonly StepKey[]>> = {
  hub: [
    'instructor.hub.1',
    'instructor.hub.2',
    'instructor.hub.3',
    'instructor.hub.4',
    'instructor.hub.5',
  ],
  console: [
    'instructor.console.1',
    'instructor.console.2',
    'instructor.console.3',
    'instructor.console.4',
  ],
  bid: ['instructor.bid.1', 'instructor.bid.2', 'instructor.bid.3', 'instructor.bid.4'],
  receipt: ['instructor.receipt.1', 'instructor.receipt.2', 'instructor.receipt.3'],
  verify: ['instructor.verify.1', 'instructor.verify.2', 'instructor.verify.3'],
  try: ['instructor.try.1', 'instructor.try.2', 'instructor.try.3'],
};

export interface RoomFacts {
  readonly status: AuctionStatus | null;
  /** The lot was stopped, sold or settled: nothing more happens in this room. */
  readonly ended: boolean;
}

/** Current step of the hub from the live room: before the lot opens, while it runs, after it. */
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
