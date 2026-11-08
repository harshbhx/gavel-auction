import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChainCheck } from '../../src/chain/ChainCheck';
import { verifyLedger } from '../../src/chain/verifyLedger';
import { t } from '../../src/copy/t';
import ReplayScreen from '../../src/screens/replay/ReplayScreen';
import { happy } from '../../src/testing/scenarios/happy';
import { makeLedgerBundle, tamperedBundle } from '../support/ledgerBundle';

const recording = {
  version: 1,
  title: 'Spring Gala demo',
  events: happy.steps.flatMap((s) => (s.emit === undefined ? [] : [{ t: s.at, msg: s.emit }])),
};

describe('verifyLedger', () => {
  it('verifies an untouched bundle against its head hash', () => {
    const v = verifyLedger(makeLedgerBundle());
    expect(v).toMatchObject({ kind: 'verified', count: 2, closed: true });
  });

  it('names the entry whose content was edited', () => {
    expect(verifyLedger(tamperedBundle(0))).toEqual({
      kind: 'broken',
      entry: 1,
      reason: 'bad_hash',
    });
    expect(verifyLedger(tamperedBundle(1))).toMatchObject({ kind: 'broken', entry: 2 });
  });

  it('detects a removed tail through the head hash', () => {
    const b = makeLedgerBundle();
    const cut = { ...b, events: b.events.slice(0, 1), count: 1 };
    expect(verifyLedger(cut)).toEqual({ kind: 'broken', entry: 1, reason: 'truncated' });
  });

  it('reports none and invalid without throwing', () => {
    expect(verifyLedger(undefined)).toEqual({ kind: 'none' });
    expect(verifyLedger({ version: 9 })).toEqual({ kind: 'invalid' });
    expect(verifyLedger('x')).toEqual({ kind: 'invalid' });
  });
});

describe('ChainCheck', () => {
  it('shows the verified badge and the plain-words explanation', () => {
    render(<ChainCheck ledger={makeLedgerBundle()} />);
    expect(screen.getByText(t('chain.verified'))).toBeTruthy();
    expect(screen.getByText(t('chain.explain.proves'))).toBeTruthy();
    expect(screen.getByText(t('chain.explain.notProves'))).toBeTruthy();
  });

  it('shows chain broken at entry N for a tampered bundle', () => {
    render(<ChainCheck ledger={tamperedBundle(1)} />);
    expect(screen.getByRole('alert').textContent).toContain(t('chain.broken', { n: 2 }));
    expect(screen.queryByText(t('chain.verified'))).toBeNull();
  });

  it('says nothing was verified when no ledger is attached', () => {
    render(<ChainCheck />);
    expect(screen.getByText(t('chain.none'))).toBeTruthy();
    expect(screen.queryByText(t('chain.verified'))).toBeNull();
  });

  it('checks a ledger file the judge picks', async () => {
    render(<ChainCheck allowFile />);
    const file = new File([JSON.stringify(tamperedBundle(0))], 'bundle.json', {
      type: 'application/json',
    });
    fireEvent.change(screen.getByLabelText(t('chain.file.label')), { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText(t('chain.broken', { n: 1 }))).toBeTruthy();
    });
  });
});

describe('ReplayScreen chain badge', () => {
  it('shows chain verified when the recording carries its ledger', async () => {
    render(
      <ReplayScreen
        recordingId="r1"
        autoplay={false}
        loadBundle={() => Promise.resolve({ ...recording, ledger: makeLedgerBundle() })}
      />,
    );
    expect(await screen.findByText(t('chain.verified'))).toBeTruthy();
  });

  it('shows the broken badge when the ledger was edited', async () => {
    render(
      <ReplayScreen
        recordingId="r1"
        autoplay={false}
        loadBundle={() => Promise.resolve({ ...recording, ledger: tamperedBundle(0) })}
      />,
    );
    expect(await screen.findByText(t('chain.broken', { n: 1 }))).toBeTruthy();
  });

  it('does not claim verification for a recording without a ledger', async () => {
    render(
      <ReplayScreen
        recordingId="r1"
        autoplay={false}
        loadBundle={() => Promise.resolve(recording)}
      />,
    );
    expect(await screen.findByText(t('chain.none'))).toBeTruthy();
    expect(screen.queryByText(t('chain.verified'))).toBeNull();
  });
});
