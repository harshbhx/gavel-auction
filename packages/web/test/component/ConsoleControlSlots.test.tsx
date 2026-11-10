import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { createControlPort } from '../../src/net/controlPort';
import type { ControlPort } from '../../src/net/transport';
import { CONTROL_ORDER, Controls } from '../../src/screens/console/Controls';
import type { AuctionStatus } from '../../src/wire';

function fakePort(over: Partial<ControlPort> = {}): ControlPort {
  return {
    open: vi.fn(() => Promise.resolve()),
    pause: vi.fn(() => Promise.resolve()),
    resume: vi.fn(() => Promise.resolve()),
    extend: vi.fn(() => Promise.resolve()),
    hammer: vi.fn(() => Promise.resolve()),
    kill: vi.fn(() => Promise.resolve()),
    ...over,
  };
}

function bar(status: AuctionStatus, port: ControlPort = fakePort(), online = true) {
  return (
    <Controls
      port={port}
      lotId="lot1"
      status={status}
      online={online}
      stopped={false}
      leader={null}
      priceCents={0}
    />
  );
}

function slots(): string[] {
  return Array.from(document.querySelectorAll('[data-testid="control-bar"] > [data-control]')).map(
    (n) => n.getAttribute('data-control') ?? '',
  );
}

describe('control bar slots (UIX-46)', () => {
  it('renders every control in the same order in every lot state', () => {
    const states: AuctionStatus[] = ['SCHEDULED', 'OPEN', 'PAUSED', 'CLOSING', 'DONE'];
    for (const status of states) {
      const { unmount } = render(bar(status));
      expect(slots()).toEqual(['open', 'pause', 'resume', 'extend', 'hammer']);
      expect(slots()).toEqual([...CONTROL_ORDER]);
      unmount();
    }
  });

  it('shows no per-button text: reasons go to one reserved line below the bar', () => {
    render(bar('OPEN'));
    // Reason text per button is spoken (sr-only) and never takes room in the bar.
    const reasons = document.querySelectorAll('[data-testid="control-bar"] span[id]');
    expect(reasons.length).toBeGreaterThan(0);
    reasons.forEach((r) => expect(r.classList.contains('gv-sr-only')).toBe(true));
    const line = document.querySelector('[data-slot="control-reason"]');
    expect(line?.textContent).toBe('');
  });

  it('Extend works while the lot is open and never says it is already open', async () => {
    const port = fakePort();
    render(bar('OPEN', port));
    const extend = screen.getByRole('button', { name: t('console.extend', { s: 30 }) });
    expect(extend.getAttribute('aria-disabled')).toBeNull();
    fireEvent.focus(extend);
    const line = document.querySelector('[data-slot="control-reason"]');
    expect(line?.textContent).toBe('');
    await act(async () => {
      fireEvent.click(extend);
      await Promise.resolve();
    });
    expect(port.extend).toHaveBeenCalledWith(30_000);
    expect(port.open).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(t('controls.reason.alreadyOpen'));
  });

  it('keeps the same slots while a request is in flight and spins inside the clicked one', async () => {
    let finish: () => void = () => undefined;
    const port = fakePort({
      extend: vi.fn(
        () =>
          new Promise<void>((res) => {
            finish = res;
          }),
      ),
    });
    render(bar('OPEN', port));
    fireEvent.click(screen.getByRole('button', { name: t('console.extend', { s: 30 }) }));
    expect(slots()).toEqual([...CONTROL_ORDER]);
    const extend = screen.getByRole('button', { name: t('console.extend', { s: 30 }) });
    expect(extend.querySelector('.gv-console-controls__spinner')).not.toBeNull();
    expect(document.querySelectorAll('.gv-console-controls__spinner')).toHaveLength(1);
    // The others are disabled with the waiting reason, and do not move.
    const pause = screen.getByRole('button', { name: t('console.pause') });
    expect(pause.getAttribute('aria-disabled')).toBe('true');
    fireEvent.focus(pause);
    expect(document.querySelector('[data-slot="control-reason"]')?.textContent).toBe(
      t('controls.reason.busy'),
    );
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(document.querySelector('.gv-console-controls__spinner')).toBeNull();
    expect(slots()).toEqual([...CONTROL_ORDER]);
  });

  it('explains Open lot: off once the lot is open, on while scheduled', () => {
    const { rerender } = render(bar('OPEN'));
    const open = () => screen.getByRole('button', { name: t('console.open') });
    expect(open().getAttribute('aria-disabled')).toBe('true');
    fireEvent.focus(open());
    expect(document.querySelector('[data-slot="control-reason"]')?.textContent).toBe(
      t('controls.reason.alreadyOpen'),
    );
    rerender(bar('SCHEDULED'));
    expect(open().getAttribute('aria-disabled')).toBeNull();
    fireEvent.focus(screen.getByRole('button', { name: t('console.pause') }));
    expect(document.querySelector('[data-slot="control-reason"]')?.textContent).toBe(
      t('controls.reason.openFirst'),
    );
  });

  it('says the lot is paused on the controls that need it running', () => {
    render(
      <Controls
        port={fakePort()}
        lotId="l"
        status="PAUSED"
        online
        stopped={false}
        leader={null}
        priceCents={0}
      />,
    );
    fireEvent.focus(screen.getByRole('button', { name: t('console.extend', { s: 30 }) }));
    expect(document.querySelector('[data-slot="control-reason"]')?.textContent).toBe(
      t('controls.reason.paused'),
    );
    expect(
      screen.getByRole('button', { name: t('console.resume') }).getAttribute('aria-disabled'),
    ).toBeNull();
  });

  it('reserves the result line even when empty', () => {
    render(bar('OPEN'));
    const status = document.querySelector('.gv-console-controls__result');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.textContent).toBe('');
  });
});

describe('controlId per action (UIX-46)', () => {
  it('mints a new id for every action, never one used before', async () => {
    const ids: string[] = [];
    const port = createControlPort({
      auctionId: 'A1',
      token: 'tok',
      fetch: (_url, init) => {
        ids.push((JSON.parse(init.body) as { controlId: string }).controlId);
        return Promise.resolve({ ok: true, status: 200 });
      },
    });
    for (let i = 0; i < 20; i++) {
      await port.extend(30_000);
      await port.pause();
    }
    expect(new Set(ids).size).toBe(40);
    ids.forEach((id) => expect(id.length).toBeLessThanOrEqual(64));
  });

  it('two ports on a fresh page never share an id', async () => {
    const seen: string[] = [];
    const make = () =>
      createControlPort({
        auctionId: 'A1',
        token: 'tok',
        fetch: (_u, init) => {
          seen.push((JSON.parse(init.body) as { controlId: string }).controlId);
          return Promise.resolve({ ok: true, status: 200 });
        },
      });
    await make().extend(1000);
    await make().pause();
    expect(new Set(seen).size).toBe(2);
  });

  it('retries a timed-out action under the same id and the next action gets a new one', async () => {
    vi.useFakeTimers();
    const bodies: Array<{ controlId: string; action: string }> = [];
    let first = true;
    const port = createControlPort({
      auctionId: 'A1',
      token: 'tok',
      timeoutMs: 100,
      fetch: (_u, init) => {
        bodies.push(JSON.parse(init.body) as { controlId: string; action: string });
        if (first) {
          first = false;
          return new Promise(() => undefined);
        }
        return Promise.resolve({ ok: true, status: 200 });
      },
    });
    const done = port.extend(30_000);
    await vi.advanceTimersByTimeAsync(150);
    await done;
    await port.pause();
    vi.useRealTimers();
    expect(bodies).toHaveLength(3);
    expect(bodies[0]?.controlId).toBe(bodies[1]?.controlId);
    expect(bodies[2]?.controlId).not.toBe(bodies[0]?.controlId);
    expect(bodies[2]?.action).toBe('pause');
  });
});
