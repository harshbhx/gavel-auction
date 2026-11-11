import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../../src/copy/t';
import { VerifyPanel, verdictForText } from '../../src/chain/VerifyPanel';
import { WatcherGate } from '../../src/screens/join/WatcherGate';
import ReplayScreen from '../../src/screens/replay/ReplayScreen';

describe('verify page', () => {
  it('says why Check this ledger is off while the box is empty', () => {
    render(<VerifyPanel />);
    expect(screen.getByText(t('verify.check.disabled'))).toBeTruthy();
    expect(screen.getByRole('heading', { name: t('verify.title') })).toBeTruthy();
    expect(t('verify.title')).not.toBe(t('verify.page.title'));
  });

  it('calls pasted text a ledger export, not a file', () => {
    expect(verdictForText('abc').kind).toBe('invalid');
    expect(t('chain.invalid.detail')).not.toMatch(/file/i);
  });
});

describe('receipt link of a visitor', () => {
  it('says the receipt appears after the hammer', () => {
    render(<WatcherGate roomId="r1" onNavigate={() => undefined} receipt />);
    expect(screen.getByText(t('watch.receiptNote'))).toBeTruthy();
  });
});

describe('replay of an unknown id', () => {
  it('shows one message and a link to the audit trail', async () => {
    render(
      <ReplayScreen
        recordingId="room-1"
        autoplay={false}
        loadBundle={() => Promise.reject(new Error('missing'))}
      />,
    );
    expect(await screen.findByText(t('replay.invalid'))).toBeTruthy();
    expect(screen.queryByText(t('prov.recorded'))).toBeNull();
    expect(screen.getByRole('link', { name: t('replay.invalid.room') }).getAttribute('href')).toBe(
      '/r/room-1/audit',
    );
  });
});
