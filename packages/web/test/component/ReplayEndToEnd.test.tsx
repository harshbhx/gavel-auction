import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REPLAY_BUNDLE_VERSION, REPLAY_EXPORT_VERSION, hashPublicEntry } from '@gavel/shared';
import type { ReplayBundle as Ledger, ReplayEvent as LedgerEvent } from '@gavel/shared';
import { verifyLedger } from '../../src/chain/verifyLedger';
import { t } from '../../src/copy/t';
import ReplayScreen from '../../src/screens/replay/ReplayScreen';
import { happy } from '../../src/testing/scenarios/happy';
import { formatUsd } from '../../src/util/money';

/**
 * Offline replay run (VOX-66): a cached bundle with its sealed ledger export is loaded, driven through
 * play, pause, scrub and a chapter jump on a fake clock, and the ledger view at the end must show the
 * price the sealed export recorded. No network, no keys, no audio.
 */

const HAMMER_PRICE = 35_000;

const events = happy.steps.flatMap((s) => (s.emit === undefined ? [] : [{ t: s.at, msg: s.emit }]));

/** A sealed public export: a created entry, then the hammer at the recorded price. */
function sealedLedger(): Ledger {
  const entries = [
    { type: 'AUCTION_CREATED', payload: { note: 'x' } },
    { type: 'LOT_HAMMERED', payload: { lotId: 'L1', winnerId: 'W1', priceCents: HAMMER_PRICE } },
  ];
  const out: LedgerEvent[] = [];
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
    out.push({ ...body, hash });
    prev = hash;
  });
  return {
    version: REPLAY_BUNDLE_VERSION,
    exportVersion: REPLAY_EXPORT_VERSION,
    auctionId: 'A1',
    generatedAt: 5000,
    count: out.length,
    headHash: prev,
    closed: false,
    events: out,
  };
}

const ledger = sealedLedger();
const load = (): Promise<unknown> =>
  Promise.resolve({ version: 1, title: 'Cached run', events, ledger });

function hammerFromExport(): number {
  const hit = ledger.events.find((e) => e.type === 'LOT_HAMMERED');
  const priceCents = hit?.payload['priceCents'];
  if (typeof priceCents !== 'number') throw new Error('export has no hammer');
  return priceCents;
}

const price = (): string => screen.queryByText(/^\$/)?.textContent ?? '';

describe('replay end to end, offline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('plays, pauses, scrubs and jumps, then ends on the sealed hammer price', async () => {
    expect(verifyLedger(ledger).kind).toBe('verified');
    render(<ReplayScreen recordingId="r1" autoplay={false} loadBundle={load} />);
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: t('console.resume') }));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.click(screen.getByRole('button', { name: t('console.pause') }));
    const paused = price();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(price()).toBe(paused);

    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    fireEvent.click(screen.getByRole('button', { name: t('replay.chapter.hammer') }));
    expect(price()).toBe(formatUsd(hammerFromExport()));

    fireEvent.click(screen.getByRole('button', { name: t('replay.chapter.settle') }));
    expect(price()).toBe(formatUsd(hammerFromExport()));
    expect(screen.getByText(t('replay.frames.agree'))).toBeTruthy();
  });
});
