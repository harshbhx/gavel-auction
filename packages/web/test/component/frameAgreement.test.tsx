import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { REPLAY_BUNDLE_VERSION, REPLAY_EXPORT_VERSION, hashPublicEntry } from '@gavel/shared';
import type { ReplayBundle as Ledger, ReplayEvent as LedgerEvent } from '@gavel/shared';
import { frameAgreement } from '../../src/chain/frameAgreement';
import { t } from '../../src/copy/t';
import { parseBundle } from '../../src/screens/replay/bundle';
import ReplayScreen from '../../src/screens/replay/ReplayScreen';
import { happy } from '../../src/testing/scenarios/happy';

const recording = {
  version: 1,
  title: 'Spring Gala demo',
  events: happy.steps.flatMap((s) => (s.emit === undefined ? [] : [{ t: s.at, msg: s.emit }])),
};

/** A sealed chain whose events are the given types; a hammered lot carries its price. */
function ledgerWith(entries: Array<{ type: string; payload: Record<string, unknown> }>): Ledger {
  const events: LedgerEvent[] = [];
  let prev = '0'.repeat(64);
  entries.forEach(({ type, payload }, i) => {
    const body = {
      v: 4 as const,
      auctionId: 'A1',
      seq: i + 1,
      at: 1000,
      type,
      cmd: null,
      payload,
      redacted: [] as string[],
      fullHash: null,
      prev,
    };
    const hash = hashPublicEntry(body);
    events.push({ ...body, hash });
    prev = hash;
  });
  return {
    version: REPLAY_BUNDLE_VERSION,
    exportVersion: REPLAY_EXPORT_VERSION,
    auctionId: 'A1',
    generatedAt: 5000,
    count: events.length,
    headHash: prev,
    closed: false,
    events,
  };
}

const created = { type: 'AUCTION_CREATED', payload: { note: 'x' } };
const hammered = (priceCents: number) => ({
  type: 'LOT_HAMMERED',
  payload: { lotId: 'L1', winnerId: 'W1', priceCents },
});

function bundleOf(): Parameters<typeof frameAgreement>[0] {
  const result = parseBundle(recording);
  if (!result.ok) throw new Error('fixture recording is invalid');
  return result.bundle;
}

describe('frameAgreement', () => {
  it('agrees when the hammer frame carries the sealed price', () => {
    expect(frameAgreement(bundleOf(), ledgerWith([created, hammered(35_000)]))).toEqual({
      kind: 'agree',
      hammers: 1,
    });
  });

  it('disagrees when the frames were edited to another price', () => {
    expect(frameAgreement(bundleOf(), ledgerWith([created, hammered(10_000)]))).toEqual({
      kind: 'disagree',
      hammer: 1,
    });
  });

  it('disagrees when the ledger has no hammer but the frames show one', () => {
    expect(frameAgreement(bundleOf(), ledgerWith([created]))).toEqual({
      kind: 'disagree',
      hammer: 1,
    });
  });

  it('claims nothing for a ledger that does not verify or is missing', () => {
    const broken = ledgerWith([created, hammered(35_000)]);
    const entry = broken.events[1];
    if (entry === undefined) throw new Error('no entry');
    entry.payload = { ...entry.payload, priceCents: 1 };
    expect(frameAgreement(bundleOf(), broken)).toEqual({ kind: 'unchecked' });
    expect(frameAgreement(bundleOf(), undefined)).toEqual({ kind: 'unchecked' });
  });
});

describe('ReplayScreen frame agreement note', () => {
  const load = (ledger: Ledger) => () => Promise.resolve({ ...recording, ledger });

  it('says the hammer price matches the ledger', async () => {
    render(
      <ReplayScreen
        recordingId="r1"
        autoplay={false}
        loadBundle={load(ledgerWith([created, hammered(35_000)]))}
      />,
    );
    expect(await screen.findByText(t('replay.frames.agree'))).toBeTruthy();
  });

  it('warns when the frames do not match the ledger', async () => {
    render(
      <ReplayScreen
        recordingId="r1"
        autoplay={false}
        loadBundle={load(ledgerWith([created, hammered(10_000)]))}
      />,
    );
    expect(await screen.findByText(t('replay.frames.disagree', { n: 1 }))).toBeTruthy();
    expect(screen.queryByText(t('replay.frames.agree'))).toBeNull();
  });
});
