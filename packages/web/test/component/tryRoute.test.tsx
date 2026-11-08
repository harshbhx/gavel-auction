import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { judgeRoomsStatus } from '../../src/net/judgeRooms';
import { forgetHubKeys, rememberHubKeys } from '../../src/screens/hub/hubKeys';
import { JudgePanel } from '../../src/screens/judge/JudgePanel';
import { RoomCard } from '../../src/screens/judge/RoomCard';
import { liveRoomFrom, type LiveRoom } from '../../src/screens/judge/liveRoom';
import { RUN_MS, finalStage, initialStage } from '../../src/screens/judge/judgeScript';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  forgetHubKeys();
});

function stubFetch(answer: (url: string) => Response | Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => Promise.resolve(answer(url))),
  );
}

function stubReducedMotion(on: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: on, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

const LIVE: LiveRoom = {
  roomId: 'room-1',
  code: 'ABC234',
  console: '/r/room-1/console#token=aud',
  screen: '/r/room-1/screen#token=scr',
  receipt: '/r/room-1/receipt',
  hub: '/r/room-1/hub#token=aud',
  join: '/join/room-1?c=ABC234',
};

interface PanelOptions {
  rooms?: 'on' | 'busy' | 'off' | 'unreachable' | 'checking' | 'noServer';
  createRoom?: () => Promise<never>;
  openRoom?: (href: string) => void;
  joinByCode?: (code: string) => Promise<boolean>;
  room?: LiveRoom | null;
  autoplay?: boolean;
}

function panel(options: PanelOptions = {}) {
  return (
    <JudgePanel
      rooms={options.rooms ?? 'on'}
      createRoom={options.createRoom ?? (() => Promise.reject(new Error('unused')))}
      openRoom={options.openRoom ?? vi.fn()}
      joinByCode={options.joinByCode ?? (() => Promise.resolve(true))}
      room={options.room === undefined ? null : options.room}
      autoplay={options.autoplay ?? false}
    />
  );
}

function barButton(label: Parameters<typeof t>[0]): HTMLElement {
  const bar = screen.getByRole('navigation', { name: t('try.bar.label') });
  return within(bar).getByRole('button', { name: new RegExp(`^${t(label as 'try.bar.join')}`) });
}

function typeCode(value: string): void {
  fireEvent.change(screen.getByLabelText(t('ui.code.char', { n: 1, length: 6 })), {
    target: { value },
  });
}

describe('/try judge panel: the Ledger front page', () => {
  beforeEach(() => stubReducedMotion(false));

  it('has a masthead, one headline, the simulated figure and three moves', () => {
    render(<App initialPath="/try" />);
    expect(screen.getByText(t('try.brand'))).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 }).length).toBe(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(t('try.hl2'));
    expect(screen.getByText(t('try.fig'))).toBeTruthy();
    expect(screen.getByRole('list', { name: t('try.stepsLabel') }).children.length).toBe(4);
    for (const title of ['try.a1.title', 'try.a2.title', 'try.a3.title'] as const) {
      expect(screen.getByRole('heading', { level: 3, name: t(title) })).toBeTruthy();
    }
    expect(screen.getByText(t('try.quote'))).toBeTruthy();
  });

  it('labels the figure as simulated and the receipt as simulated', () => {
    render(panel({ autoplay: false }));
    expect(screen.getByText(t('try.simTag'))).toBeTruthy();
    expect(screen.getByText(t('try.slip.sim'))).toBeTruthy();
    expect(screen.getByText(t('try.simMeta'))).toBeTruthy();
  });

  it('lists what is proven and what is not claimed, from the gates', () => {
    render(panel());
    const proven = screen.getByRole('region', { name: t('try.ev.proven') });
    const not = screen.getByRole('region', { name: t('try.ev.notClaimed') });
    expect(within(proven).getAllByRole('listitem').length).toBe(5);
    expect(within(not).getAllByRole('listitem').length).toBe(5);
    expect(within(not).getByText(t('try.ev.n2'))).toBeTruthy();
    expect(within(not).getByText(t('try.ev.n3'))).toBeTruthy();
    expect(within(not).getByText(t('try.ev.n4'))).toBeTruthy();
    expect(within(not).getByText(t('try.ev.n5d'))).toBeTruthy();
    expect(screen.getByRole('link', { name: t('try.ev.trust') }).getAttribute('href')).toBe(
      'https://gavel-docs.creharsh.workers.dev/docs/judges/trust-and-faq',
    );
    expect(screen.getByRole('link', { name: t('try.ev.buyers') }).getAttribute('href')).toBe(
      'https://gavel-docs.creharsh.workers.dev/docs/judges/sandbox-buyers',
    );
  });

  it('has no server in this build: start is blocked and the scripted demo stays open', () => {
    render(<App initialPath="/try" />);
    expect(screen.getByText(t('try.status.noServer'))).toBeTruthy();
    expect(
      screen.getByRole('button', { name: t('try.a1.room') }).getAttribute('aria-disabled'),
    ).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain(t('try.a1.open'));
    expect(screen.getByRole('link', { name: t('try.a1.script') }).getAttribute('href')).toBe(
      '/demo/scripted',
    );
  });

  it('starts a room and opens its page', async () => {
    const createRoom = vi.fn(() =>
      Promise.resolve({ console: '/c', screen: '/s', bidder: '/b', audit: '/a', hub: '/r/x/hub' }),
    );
    const openRoom = vi.fn();
    render(panel({ createRoom: createRoom as never, openRoom }));
    fireEvent.click(screen.getByRole('button', { name: t('try.a1.room') }));
    await waitFor(() => expect(openRoom).toHaveBeenCalledWith('/r/x/hub'));
  });

  it('says why a room could not be made', async () => {
    render(panel({ createRoom: () => Promise.reject(new Error('down')) }));
    fireEvent.click(screen.getByRole('button', { name: t('try.a1.room') }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('try.a1.failed'));
    expect(alert.textContent).toContain(t('demo.failed'));
    expect(screen.getByRole('link', { name: t('try.a1.script') })).toBeTruthy();
  });

  it('reports an unknown room code', async () => {
    render(panel({ joinByCode: () => Promise.resolve(false) }));
    typeCode('NOROOM');
    fireEvent.click(screen.getByRole('button', { name: t('try.a2.go') }));
    await waitFor(() =>
      expect(screen.getAllByText(t('landing.codeInvalid')).length).toBeGreaterThan(0),
    );
  });

  it('accepts a code with a GVL- start, spaces and lower case', async () => {
    const joinByCode = vi.fn(() => Promise.resolve(true));
    render(panel({ joinByCode }));
    typeCode('gvl- k7m2qx');
    fireEvent.click(screen.getByRole('button', { name: t('try.a2.go') }));
    await waitFor(() => expect(joinByCode).toHaveBeenCalledWith('K7M2QX'));
  });

  it('goes straight to the join page when this build has no server', () => {
    const openRoom = vi.fn();
    render(panel({ rooms: 'noServer', openRoom }));
    typeCode('GVL-K7M2QX');
    fireEvent.click(screen.getByRole('button', { name: t('try.a2.go') }));
    expect(openRoom).toHaveBeenCalledWith('/join/K7M2QX');
  });

  it('does not look a code up until one is typed', () => {
    const joinByCode = vi.fn(() => Promise.resolve(true));
    render(panel({ joinByCode }));
    expect(screen.getByRole('button', { name: t('try.a2.go') }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(joinByCode).not.toHaveBeenCalled();
  });

  it('shows the room it already holds, from this tab', () => {
    rememberHubKeys('r9', { auctioneer: 'a', screen: 's', expiresAt: null, code: 'ZZ9988' });
    render(<JudgePanel rooms="on" createRoom={vi.fn()} openRoom={vi.fn()} joinByCode={vi.fn()} />);
    expect(screen.getAllByText('ZZ9988').length).toBeGreaterThan(0);
  });
});

describe('room card', () => {
  it('shows a labelled sample, never a real code, when there is no live room', () => {
    render(<RoomCard room={null} />);
    expect(screen.getByText(t('try.room.sample'))).toBeTruthy();
    expect(screen.getByText(t('try.room.sampleNote'))).toBeTruthy();
    expect(screen.getByRole('img', { name: t('try.room.qrSample') })).toBeTruthy();
  });

  it('shows the live code and a QR of the join page, and copies the code', async () => {
    const writeClipboard = vi.fn(() => Promise.resolve());
    render(<RoomCard room={LIVE} writeClipboard={writeClipboard} origin="https://x.test" />);
    expect(screen.getByText(t('try.room.live'))).toBeTruthy();
    expect(screen.getByText('ABC234')).toBeTruthy();
    expect(screen.getByRole('group', { name: t('try.room.qrLive') })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('try.room.copy') }));
    await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith('ABC234'));
    expect(await screen.findByRole('button', { name: t('generic.copied') })).toBeTruthy();
  });

  it('falls back to the sample when the room has no code', () => {
    render(<RoomCard room={{ ...LIVE, code: null }} />);
    expect(screen.getByText(t('try.room.sample'))).toBeTruthy();
  });
});

describe('live room links', () => {
  it('builds console, screen, receipt and join links from the keys this tab holds', () => {
    const room = liveRoomFrom({
      roomId: 'a b',
      keys: { auctioneer: 'tok', screen: 'scr', expiresAt: null, code: 'K7M2QX' },
    });
    expect(room?.console).toBe('/r/a%20b/console#token=tok');
    expect(room?.screen).toBe('/r/a%20b/screen#token=scr');
    expect(room?.receipt).toBe('/r/a%20b/receipt');
    expect(room?.join).toBe('/join/a%20b?c=K7M2QX');
    expect(liveRoomFrom(null)).toBeNull();
  });
});

describe('judge dialog', () => {
  beforeEach(() => stubReducedMotion(false));

  it('explains that console, screen and receipt open inside a room, and links the docs', () => {
    render(panel());
    fireEvent.click(barButton('try.bar.console'));
    const dialog = screen.getByRole('dialog', { name: t('try.dlg.label') });
    expect(within(dialog).getByText(t('try.dlg.needsRoom'))).toBeTruthy();
    expect(
      within(dialog)
        .getByRole('link', { name: t('try.a1.room') })
        .getAttribute('href'),
    ).toBe('/demo');
    expect(
      within(dialog)
        .getByRole('link', { name: t('try.ev.trust') })
        .getAttribute('href'),
    ).toContain('/docs/judges/trust-and-faq');
  });

  it('switches tabs with the arrow keys and closes with Escape', () => {
    render(panel());
    fireEvent.click(barButton('try.bar.join'));
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(6);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tabs[0] as HTMLElement, { key: 'ArrowRight' });
    expect(screen.getAllByRole('tab')[1]?.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toContain(t('try.dlg.consoleWhat'));
    fireEvent.keyDown(screen.getAllByRole('tab')[1] as HTMLElement, { key: 'End' });
    expect(screen.getByRole('tabpanel').textContent).toContain(t('try.dlg.provenLead'));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('gives real links when this tab holds a live room', () => {
    render(panel({ room: LIVE }));
    expect(screen.getByRole('link', { name: t('try.a3.console') }).getAttribute('href')).toBe(
      LIVE.console,
    );
    expect(screen.getByRole('link', { name: t('try.a3.receipt') }).getAttribute('href')).toBe(
      LIVE.receipt,
    );
    fireEvent.click(barButton('try.bar.screen'));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog)
        .getByRole('link', { name: t('try.dlg.openScreen') })
        .getAttribute('href'),
    ).toBe(LIVE.screen);
  });
});

describe('simulated run', () => {
  it('plays the steps slowly and ends on a printed, simulated receipt', () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    render(panel());
    expect(screen.getByText(t('try.slip.empty'))).toBeTruthy();
    fireEvent.click(barButton('try.run.go'));
    act(() => {
      vi.advanceTimersByTime(3300);
    });
    expect(screen.getByText(t('try.say.s1ok', { amount: '$60' }))).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(RUN_MS);
    });
    expect(screen.getByText(t('try.say.done'))).toBeTruthy();
    expect(screen.getByText('SIM-0007-DEMO')).toBeTruthy();
    expect(screen.getByText(t('try.slip.disclaimer'))).toBeTruthy();
    expect(barButton('try.run.replay')).toBeTruthy();
  });

  it('shows the finished run at once under reduced motion', () => {
    stubReducedMotion(true);
    render(panel({ autoplay: true }));
    expect(screen.getByText(t('try.say.done'))).toBeTruthy();
    expect(screen.getByText('SIM-0007-DEMO')).toBeTruthy();
  });

  it('keeps the script in integer cents and ends with one winner and two released holds', () => {
    const end = finalStage();
    expect(initialStage().status).toBe('idle');
    expect(end.priceCents).toBe(11000);
    expect(Number.isInteger(end.priceCents)).toBe(true);
    expect(end.pads.filter((p) => p.phase === 'win').map((p) => p.no)).toEqual([27]);
    expect(end.pads.filter((p) => p.phase === 'released').length).toBe(2);
    expect(end.status).toBe('done');
  });
});

describe('judgeRoomsStatus', () => {
  it('maps the host answer to a status', async () => {
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), { status });
    stubFetch(() => json({ judgeRooms: true, accepting: true }));
    expect(await judgeRoomsStatus('http://api')).toBe('on');
    stubFetch(() => json({ judgeRooms: true, accepting: false }));
    expect(await judgeRoomsStatus('http://api')).toBe('busy');
    stubFetch(() => json({ judgeRooms: false, accepting: false }));
    expect(await judgeRoomsStatus('http://api')).toBe('off');
    stubFetch(() => json({}, 404));
    expect(await judgeRoomsStatus('http://api')).toBe('off');
    stubFetch(() => json({}, 500));
    expect(await judgeRoomsStatus('http://api')).toBe('unreachable');
    stubFetch(() => Promise.reject(new Error('network')));
    expect(await judgeRoomsStatus('http://api')).toBe('unreachable');
  });
});
