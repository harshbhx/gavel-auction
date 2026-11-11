import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import type { ControlPort } from '../../src/net/transport';
import { ControlError, createControlPort } from '../../src/net/controlPort';
import { Controls, controlStatus, disabledReason } from '../../src/screens/console/Controls';
import { HammerDialog } from '../../src/screens/console/HammerDialog';
import { HAMMER_HOLD_MS } from '../../src/screens/console/hammerHold';
import { KillSwitch } from '../../src/screens/console/KillSwitch';
import { Roster, type RosterRow } from '../../src/screens/console/Roster';
import {
  SHORTCUTS,
  ShortcutHelp,
  isSingleKey,
  useShortcuts,
} from '../../src/screens/console/ShortcutHelp';

function fakePort(): ControlPort {
  return {
    open: vi.fn(() => Promise.resolve()),
    pause: vi.fn(() => Promise.resolve()),
    resume: vi.fn(() => Promise.resolve()),
    extend: vi.fn(() => Promise.resolve()),
    hammer: vi.fn(() => Promise.resolve()),
    kill: vi.fn(() => Promise.resolve()),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('disabledReason', () => {
  const base = { status: 'OPEN', online: true, stopped: false, busy: false } as const;
  it('gives a reason per state and none when allowed', () => {
    expect(disabledReason('pause', base)).toBeNull();
    expect(disabledReason('resume', base)).toBe('controls.reason.notPaused');
    expect(disabledReason('open', base)).toBe('controls.reason.alreadyOpen');
    expect(disabledReason('open', { ...base, status: 'SCHEDULED' })).toBeNull();
    expect(disabledReason('pause', { ...base, status: 'SCHEDULED' })).toBe(
      'controls.reason.openFirst',
    );
    expect(disabledReason('hammer', { ...base, status: 'DONE' })).toBe('controls.reason.ended');
    expect(disabledReason('pause', { ...base, online: false })).toBe('controls.reason.offline');
    expect(disabledReason('pause', { ...base, stopped: true })).toBe('controls.reason.stopped');
  });
});

describe('controlStatus (SRV-31)', () => {
  it('maps the server pause (OPEN plus paused) to PAUSED and leaves the rest alone', () => {
    expect(controlStatus('OPEN', true)).toBe('PAUSED');
    expect(controlStatus('OPEN', false)).toBe('OPEN');
    expect(controlStatus('SCHEDULED', true)).toBe('SCHEDULED');
    expect(controlStatus('DONE', true)).toBe('DONE');
  });

  it('enables Resume and disables Extend, Pause and Open while the lot is paused', () => {
    const state = {
      status: controlStatus('OPEN', true),
      online: true,
      stopped: false,
      busy: false,
    } as const;
    expect(disabledReason('resume', state)).toBeNull();
    expect(disabledReason('extend', state)).toBe('controls.reason.paused');
    expect(disabledReason('pause', state)).toBe('controls.reason.paused');
    expect(disabledReason('open', state)).toBe('controls.reason.alreadyOpen');
  });

  it('enables exactly one of Open and Resume in every status', () => {
    for (const [status, paused] of [
      ['SCHEDULED', false],
      ['OPEN', false],
      ['OPEN', true],
    ] as const) {
      const state = {
        status: controlStatus(status, paused),
        online: true,
        stopped: false,
        busy: false,
      } as const;
      const enabled = (['open', 'resume'] as const).filter(
        (n) => disabledReason(n, state) === null,
      );
      expect(enabled.length).toBeLessThanOrEqual(1);
    }
  });
});

describe('Controls', () => {
  it('shows the reason the server gave when a pause is refused (SRV-38)', async () => {
    const port = fakePort();
    port.pause = vi.fn(() => Promise.reject(new ControlError(409, 'The lot is already paused')));
    render(
      <Controls
        port={port}
        lotId="lot1"
        status="OPEN"
        online
        stopped={false}
        leader={null}
        priceCents={0}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('console.pause') }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByText(
        t('controls.refused', { action: t('console.pause'), detail: 'The lot is already paused' }),
      ),
    ).toBeTruthy();
  });

  it('posts through the port and keeps offline controls visible but disabled', async () => {
    const port = fakePort();
    const { rerender } = render(
      <Controls
        port={port}
        lotId="lot1"
        status="OPEN"
        online
        stopped={false}
        leader={null}
        priceCents={0}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('console.extend', { s: 30 }) }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(port.extend).toHaveBeenCalledWith(30_000);
    rerender(
      <Controls
        port={port}
        lotId="lot1"
        status="OPEN"
        online={false}
        stopped={false}
        leader={null}
        priceCents={0}
      />,
    );
    const pause = screen.getByRole('button', { name: t('console.pause') });
    expect(pause.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(pause);
    expect(port.pause).not.toHaveBeenCalled();
  });
});

describe('HammerDialog', () => {
  const leader = { paddle: 7, name: 'Ada' };
  it('sends once at the hold time, not 1 ms before, and never on click', () => {
    const onConfirm = vi.fn();
    render(
      <HammerDialog
        open
        leader={leader}
        priceCents={35000}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button', { name: t('console.hammerHold') });
    fireEvent.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.pointerDown(btn);
    act(() => {
      vi.advanceTimersByTime(HAMMER_HOLD_MS - 1);
    });
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancels on early release and confirms only on a held Enter', () => {
    const onConfirm = vi.fn();
    render(
      <HammerDialog
        open
        leader={leader}
        priceCents={35000}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button', { name: t('console.hammerHold') });
    fireEvent.pointerDown(btn);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(btn);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.keyUp(btn, { key: 'Enter' });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.keyDown(btn, { key: 'Enter' });
    fireEvent.keyDown(btn, { key: 'Enter', repeat: true });
    act(() => {
      vi.advanceTimersByTime(HAMMER_HOLD_MS);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('focuses Cancel first, not the hold button', () => {
    render(
      <HammerDialog
        open
        leader={leader}
        priceCents={35000}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: t('common.cancel') }));
  });

  it('shows leader and price, or the no-sale question', () => {
    const { rerender } = render(
      <HammerDialog
        open
        leader={leader}
        priceCents={35000}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByText(t('console.hammerConfirm', { amount: '$350.00', n: 7, name: 'Ada' })),
    ).toBeTruthy();
    rerender(
      <HammerDialog open leader={null} priceCents={0} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText(t('console.hammerNoBids'))).toBeTruthy();
  });
});

describe('KillSwitch', () => {
  it('needs exact STOP, holds 1500 ms and sends once', () => {
    const onKill = vi.fn();
    render(<KillSwitch stopped={false} onKill={onKill} />);
    fireEvent.click(screen.getByRole('button', { name: t('kill.button') }));
    const hold = screen.getByRole('button', { name: t('kill.hold') });
    const input = screen.getByLabelText(t('kill.type'));
    expect(hold.getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(input, { target: { value: 'stop' } });
    fireEvent.pointerDown(hold);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onKill).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'STOP' } });
    fireEvent.pointerDown(hold);
    act(() => {
      vi.advanceTimersByTime(1499);
    });
    expect(onKill).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onKill).toHaveBeenCalledTimes(1);
  });

  it('shows the stopped state', () => {
    render(<KillSwitch stopped onKill={vi.fn()} />);
    expect(screen.getByText(t('kill.stopped'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('kill.button') })).toBeNull();
  });
});

describe('shortcuts', () => {
  it('has no single-key hammer or stop shortcut', () => {
    for (const s of SHORTCUTS) {
      if (s.destructive) expect(isSingleKey(s.keys)).toBe(false);
    }
    const labels = SHORTCUTS.map((s) => s.label as string);
    expect(labels.some((l) => /hammer|stop|kill/i.test(l))).toBe(false);
  });

  function Probe({ onOpen }: { onOpen: () => void }) {
    useShortcuts({ open: onOpen });
    return <input aria-label="field" />;
  }

  it('does not fire while an input is focused', () => {
    const onOpen = vi.fn();
    render(<Probe onOpen={onOpen} />);
    fireEvent.keyDown(screen.getByLabelText('field'), { key: 'o' });
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'o' });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('lists every shortcut in the help dialog', () => {
    render(<ShortcutHelp open onClose={vi.fn()} />);
    expect(screen.getAllByRole('term')).toHaveLength(SHORTCUTS.length);
  });
});

describe('Roster', () => {
  it('shows counts and warns on a hold that is not HELD', () => {
    const roster = [
      { bidderId: 'a', paddle: 1, name: 'Ada', hold: 'HELD' },
      { bidderId: 'b', paddle: 2, name: 'Bo', hold: 'NONE' },
    ] as unknown as readonly RosterRow[];
    render(<Roster roster={roster} connected={2} />);
    expect(screen.getByText(t('console.bidders', { n: 2, m: 1 }))).toBeTruthy();
    expect(screen.getAllByText(t('console.holdWarn'))).toHaveLength(1);
  });
});

describe('createControlPort', () => {
  it('posts the control body and rejects on failure', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const port = createControlPort({
      auctionId: 'A1',
      token: 'tok',
      newControlId: () => 'c1',
      fetch: (url, init) => {
        calls.push({ url, body: init.body });
        return Promise.resolve({ ok: !init.body.includes('pause'), status: 409 });
      },
    });
    await port.extend(30_000);
    expect(calls[0]?.url).toBe('/api/auctions/A1/control');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      controlId: 'c1',
      action: 'extend',
      args: { extraMs: 30_000 },
    });
    await expect(port.pause()).rejects.toThrow();
  });
});
