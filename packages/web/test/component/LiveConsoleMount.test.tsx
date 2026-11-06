import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { LiveConsole } from '../../src/screens/console/LiveConsole';
import { KILL_HOLD_MS } from '../../src/screens/console/KillSwitch';
import { roomStore } from '../../src/store/roomStore';
import { openSnapshot, roster, stateMsg } from '../../src/testing/builders';

beforeEach(() => {
  vi.useFakeTimers();
  roomStore.dispatch({ kind: 'wire', msg: stateMsg(1, openSnapshot(roster([12, 'Priya']))) }, 0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderConsole() {
  return render(
    <LiveConsole
      room={null}
      roomId="lot-one"
      token="plain-fake-word"
      apiBase="http://localhost"
      onConfirmAnswer={() => undefined}
      rejection=""
    />,
  );
}

describe('LiveConsole mounts every console piece', () => {
  it('shows the controls, manual entry, voice feed, confirm queue and kill switch', () => {
    renderConsole();
    expect(screen.getByRole('button', { name: t('console.pause') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('console.hammer') })).toBeTruthy();
    expect(screen.getByRole('form', { name: t('console.manual') })).toBeTruthy();
    expect(screen.getAllByRole('region', { name: t('console.voice') }).length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('region', { name: t('console.confirmQueue') }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: t('kill.button') })).toBeTruthy();
  });

  it('keeps resume unavailable while the lot is open', () => {
    renderConsole();
    const resume = screen.getByRole('button', { name: t('console.resume') });
    expect(resume.getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps the typed bid and says it was not sent when there is no room', () => {
    renderConsole();
    fireEvent.change(screen.getByLabelText(t('console.manual.paddle')), {
      target: { value: '12' },
    });
    fireEvent.change(screen.getByLabelText(t('console.manual.amount')), {
      target: { value: '500' },
    });
    fireEvent.submit(screen.getByRole('form', { name: t('console.manual') }));
    expect((screen.getByLabelText(t('console.manual.amount')) as HTMLInputElement).value).toBe(
      '500',
    );
    expect(screen.getByText(t('console.manual.noRoom'))).toBeTruthy();
  });

  it('says the stop failed because the server has no stop route', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status: 404 }));
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: t('kill.button') }));
    fireEvent.change(screen.getByLabelText(t('kill.type')), { target: { value: 'STOP' } });
    const hold = screen.getByRole('button', { name: t('kill.hold') });
    fireEvent.keyDown(hold, { key: 'Enter' });
    await act(async () => {
      vi.advanceTimersByTime(KILL_HOLD_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
    expect(alerts).toContain(t('kill.notAvailable'));
    expect(screen.queryByText(t('kill.stopped'))).toBeNull();
  });
});
