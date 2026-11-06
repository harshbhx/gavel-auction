import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Cents } from '@gavel/shared';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { ScreenView } from '../../src/screens/screen/ScreenView';
import { RoomStore } from '../../src/store/roomStore';
import { bidderId, openSnapshot, roster, stateMsg } from '../../src/testing/builders';

const API = { apiBase: 'http://localhost:1', payments: 'fake', paypalClientId: 'none' } as const;

describe('routes mount the state screens', () => {
  it('shows the launcher at /demo with its provenance label and a scripted fallback', async () => {
    render(<App initialPath="/demo" api={API} />);
    expect(screen.getByText(t('prov.live'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('landing.start') }));
    await waitFor(() => expect(screen.getByText(t('demo.failed'))).toBeTruthy());
    expect(screen.getByRole('button', { name: t('demo.scriptedInstead') })).toBeTruthy();
  });

  it('shows the token gate with a link to the launcher on the console without a token', () => {
    render(<App initialPath="/r/nowhere/console" liveBase="ws://localhost:1" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('err.tokenMissing'));
    expect(screen.getByRole('link', { name: t('err.newLink') })).toBeTruthy();
    expect(screen.getByText(t('banner.sandbox'))).toBeTruthy();
  });

  it('shows the not found screen with the sandbox banner and a way home', () => {
    render(<App initialPath="/nope/at/all" />);
    expect(screen.getByText(t('err.notFound'))).toBeTruthy();
    expect(screen.getByText(t('banner.sandbox'))).toBeTruthy();
    expect(screen.getByRole('link', { name: t('err.home') })).toBeTruthy();
  });
});

describe('public screen states', () => {
  it('flashes the live price and keeps a polite region for it', () => {
    const store = new RoomStore();
    const snap = { ...openSnapshot(roster([7, 'Eve'])), price: Cents(12_000) };
    store.dispatch({ kind: 'wire', msg: stateMsg(1, snap) });
    const { container } = render(
      <ScreenView lotTitle="Lot" code="ZZTOPCODE" joinUrl="https://x.test/j" store={store} />,
    );
    expect(screen.getByTestId('screen-price').textContent).toBe('$120.00');
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it('shows the sold banner once the lot is closed', () => {
    const store = new RoomStore();
    const snap = {
      ...openSnapshot(roster([7, 'Eve']), undefined, 'DONE'),
      price: Cents(25_000),
      leaderId: bidderId(7),
    };
    store.dispatch({ kind: 'wire', msg: stateMsg(2, snap) });
    render(<ScreenView lotTitle="Lot" code="ZZTOPCODE" joinUrl="https://x.test/j" store={store} />);
    expect(screen.getByTestId('sold').textContent).toContain('SOLD to paddle 7');
  });
});
