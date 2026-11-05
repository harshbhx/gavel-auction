import { describe, expect, it } from 'vitest';
import { REPLAY_BUNDLE_VERSION, REPLAY_EXPORT_VERSION, isReplayBundle } from '../src/replay-bundle';

const base = {
  version: REPLAY_BUNDLE_VERSION,
  exportVersion: REPLAY_EXPORT_VERSION,
  auctionId: 'A1',
  generatedAt: 1,
  count: 0,
  headHash: null,
  events: [],
};

describe('isReplayBundle', () => {
  it('accepts an empty bundle and rejects bad shapes', () => {
    expect(isReplayBundle(base)).toBe(true);
    expect(isReplayBundle(null)).toBe(false);
    expect(isReplayBundle({ ...base, version: 2 })).toBe(false);
    expect(isReplayBundle({ ...base, count: 1 })).toBe(false);
    expect(isReplayBundle({ ...base, headHash: 'h' })).toBe(false);
    expect(isReplayBundle({ ...base, events: [{}], count: 1, headHash: null })).toBe(false);
  });
});
