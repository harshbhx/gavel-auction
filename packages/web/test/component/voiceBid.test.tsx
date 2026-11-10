import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import type { VoiceState } from '../../src/audio/voiceController';
import { VoiceBidView, amountFromCaption, type VoiceBidDeps } from '../../src/screens/bid/VoiceBid';

afterEach(cleanup);

function stateWith(text: string | null): VoiceState {
  return {
    phase: 'ready',
    talking: false,
    level: 0,
    caption: text === null ? null : { text, final: true },
    stt: 'ok',
    problem: null,
    note: null,
    replay: false,
  };
}

function deps(over: Partial<VoiceBidDeps>, text: string | null): VoiceBidDeps {
  return {
    capability: 'available',
    support: null,
    voice: { state: stateWith(text), press: vi.fn(), release: vi.fn(), setMode: vi.fn() },
    ...over,
  };
}

function view(d: VoiceBidDeps, onBid: (c: number) => void) {
  return (
    <VoiceBidView
      deps={d}
      paddle={7}
      nextMinCents={5000}
      ceilingCents={20000}
      currentCents={4500}
      onBid={onBid}
    />
  );
}

describe('VoiceBid', () => {
  it('reads dollars from a transcript as integer cents', () => {
    expect(amountFromCaption('bid $1,200')).toBe(120000);
    expect(amountFromCaption('fifty five dollars 55.50')).toBe(5550);
    expect(amountFromCaption('no digits here')).toBeNull();
  });

  it('opens the confirm sheet and sends nothing until the bidder says yes', async () => {
    const onBid = vi.fn();
    render(view(deps({}, 'I bid 150'), onBid));
    expect(screen.getByText(t('bid.voice.note'))).toBeTruthy();
    const yes = await screen.findByRole('button', { name: t('confirm.yes') });
    expect(onBid).not.toHaveBeenCalled();
    fireEvent.click(yes);
    expect(onBid).toHaveBeenCalledTimes(1);
    expect(onBid).toHaveBeenCalledWith(15000);
  });

  it('sends nothing when the bidder says no', async () => {
    const onBid = vi.fn();
    render(view(deps({}, 'I bid 150'), onBid));
    fireEvent.click(await screen.findByRole('button', { name: t('confirm.no') }));
    expect(onBid).not.toHaveBeenCalled();
  });

  it('rejects an amount over the ceiling or under the next price, with no sheet', () => {
    const onBid = vi.fn();
    const { unmount } = render(view(deps({}, 'bid 500'), onBid));
    expect(screen.getByRole('alert').textContent).toBe(t('bid.rej.over_ceiling', { max: '$200' }));
    expect(screen.queryByRole('button', { name: t('confirm.yes') })).toBeNull();
    unmount();
    render(view(deps({}, 'bid 20'), onBid));
    expect(screen.getByRole('alert').textContent).toBe(
      t('bid.rej.below_increment', { min: '$50.00' }),
    );
    expect(onBid).not.toHaveBeenCalled();
  });

  it('renders no button without a live provider or without a microphone', () => {
    const onBid = vi.fn();
    const { container, rerender } = render(view(deps({ capability: 'off' }, null), onBid));
    expect(container.innerHTML).toBe('');
    rerender(view(deps({ capability: 'replay' }, null), onBid));
    expect(container.innerHTML).toBe('');
    rerender(view(deps({ support: 'unsupported' }, null), onBid));
    expect(container.innerHTML).toBe('');
    rerender(view(deps({}, null), onBid));
    expect(screen.getByRole('button', { name: t('bid.voice.aria') })).toBeTruthy();
  });
});
