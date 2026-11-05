import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { KillSwitch } from '../../src/screens/console/KillSwitch';
import { DemoLauncher, type DemoLinks } from '../../src/screens/demo/DemoLauncher';
import { Sold } from '../../src/screens/screen/Sold';
import { useThrottledAnnounce } from '../../src/screens/screen/useThrottledAnnounce';
import { ErrorBoundary } from '../../src/screens/states/ErrorBoundary';
import { NotFound } from '../../src/screens/states/NotFound';
import { TokenGate } from '../../src/screens/states/TokenGate';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const LINKS: DemoLinks = {
  console: '/r/a/console',
  screen: '/r/a/screen',
  bidder: '/join/a',
  audit: '/r/a/audit',
};

function Probe({ text }: { text: string }) {
  return <p data-testid="probe">{useThrottledAnnounce(text)}</p>;
}

describe('useThrottledAnnounce', () => {
  it('announces at most once per 2000 ms and keeps the newest text', () => {
    const { rerender } = render(<Probe text="a" />);
    rerender(<Probe text="b" />);
    expect(screen.getByTestId('probe').textContent).toBe('b');
    rerender(<Probe text="c" />);
    rerender(<Probe text="d" />);
    expect(screen.getByTestId('probe').textContent).toBe('b');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId('probe').textContent).toBe('d');
  });
});

describe('Sold', () => {
  it('shows SOLD, Passed and the settlement summary', () => {
    const { rerender } = render(
      <Sold outcome={{ kind: 'sold', paddle: 7, amountCents: 12000 }} settlement={null} />,
    );
    expect(screen.getByText(/SOLD to paddle 7/)).toBeTruthy();
    expect(screen.queryByTestId('settle-summary')).toBeNull();
    rerender(
      <Sold
        outcome={{ kind: 'sold', paddle: 7, amountCents: 12000 }}
        settlement={{ captured: 1, released: 11 }}
      />,
    );
    expect(screen.getByTestId('settle-summary').textContent).toBe('1 captured, 11 released');
    rerender(<Sold outcome={{ kind: 'passed' }} />);
    expect(screen.getByText(t('screen.passed'))).toBeTruthy();
  });
});

describe('states', () => {
  it('token gate blocks without a token and renders with one', () => {
    const { rerender } = render(
      <TokenGate role="auctioneer" token={null}>
        <p>inside</p>
      </TokenGate>,
    );
    expect(screen.getByRole('heading', { name: t('err.tokenMissing') })).toBeTruthy();
    expect(screen.getByText(t('banner.sandbox'))).toBeTruthy();
    expect(screen.getByRole('link', { name: t('err.newLink') })).toBeTruthy();
    rerender(
      <TokenGate role="reviewer" token={['tok', 'en', 'value', '1'].join('-')}>
        <p>inside</p>
      </TokenGate>,
    );
    expect(screen.getByText('inside')).toBeTruthy();
  });

  it('404 shows the sandbox banner', () => {
    render(<NotFound />);
    expect(screen.getByText(t('banner.sandbox'))).toBeTruthy();
  });

  it('boundary shows id, reload and the banner', () => {
    const onReload = vi.fn();
    const quiet = vi.spyOn(globalThis.console, 'error').mockImplementation(() => undefined);
    function Boom(): never {
      throw new Error('boom');
    }
    render(
      <ErrorBoundary onReload={onReload} newId={() => 'e-1'}>
        <Boom />
      </ErrorBoundary>,
    );
    quiet.mockRestore();
    expect(screen.getByText(t('err.boundaryId', { id: 'e-1' }))).toBeTruthy();
    expect(screen.getByText(t('banner.sandbox'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('err.reload') }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe('KillSwitch rejection', () => {
  it('surfaces a rejected kill call', async () => {
    const onKill = vi.fn(() => Promise.reject(new Error('no route')));
    render(<KillSwitch stopped={false} onKill={onKill} />);
    fireEvent.click(screen.getByRole('button', { name: t('kill.button') }));
    fireEvent.change(screen.getByLabelText(t('kill.type')), { target: { value: 'STOP' } });
    fireEvent.keyDown(screen.getByRole('button', { name: t('kill.hold') }), { key: 'Enter' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onKill).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toBe(t('kill.failed'));
  });
});

describe('DemoLauncher', () => {
  it('shows links for a live room', async () => {
    const openConsole = vi.fn();
    render(
      <DemoLauncher
        createRoom={() => Promise.resolve(LINKS)}
        startScripted={() => LINKS}
        openConsole={openConsole}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('landing.start') }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getAllByRole('button', { name: t('generic.copy') })).toHaveLength(4);
    expect(openConsole).toHaveBeenCalledWith(LINKS.console);
    expect(screen.getByText(t('prov.live'))).toBeTruthy();
  });

  it('offers the scripted demo when the server is down', async () => {
    render(
      <DemoLauncher
        createRoom={() => Promise.reject(new Error('down'))}
        startScripted={() => LINKS}
        openConsole={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('landing.start') }));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: t('demo.scriptedInstead') }));
    expect(screen.getByText(t('prov.scripted'))).toBeTruthy();
  });
});
