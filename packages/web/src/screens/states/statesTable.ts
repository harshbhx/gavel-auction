import type { CopyKey } from '../../copy/en';

export type DataView = 'audit' | 'receipt' | 'roster' | 'bids' | 'voice' | 'replay';

export interface StateCopy {
  /** Copy key shown when the view has no data. */
  empty: CopyKey;
  /** Copy key shown while loading. */
  loading: CopyKey;
  /** Copy key shown with a retry action when loading failed. */
  error: CopyKey;
  /** Copy key shown when offline. */
  offline: CopyKey;
}

/** Every data-bearing view and the copy for its four states (R-WEB-106). */
export const STATES_TABLE: Readonly<Record<DataView, StateCopy>> = {
  audit: {
    empty: 'audit.empty',
    loading: 'state.loading',
    error: 'state.error.message',
    offline: 'state.offline',
  },
  receipt: {
    empty: 'receipt.none',
    loading: 'state.loading',
    error: 'state.error.message',
    offline: 'state.offline',
  },
  roster: {
    empty: 'state.empty.roster',
    loading: 'state.loading',
    error: 'state.error.message',
    offline: 'state.offline',
  },
  bids: {
    empty: 'state.empty.bids',
    loading: 'state.loading',
    error: 'state.error.message',
    offline: 'state.offline',
  },
  voice: {
    empty: 'console.voice.empty',
    loading: 'state.loading',
    error: 'state.error.message',
    offline: 'state.offline',
  },
  replay: {
    empty: 'state.empty.replay',
    loading: 'state.loading',
    error: 'state.error.message',
    offline: 'state.offline',
  },
};
