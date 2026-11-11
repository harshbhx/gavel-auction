import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { pickGreeting, timeAgo } from '../../src/home/greeting';
import type { HistoryRoom } from '../../src/home/history';
import { HomeScreen, type HomeScreenProps } from '../../src/home/HomeScreen';
import { ApiError } from '../../src/net/apiError';

const NOW = new Date(2026, 10, 9, 19, 30).getTime();
const MINUTE = 60_000;

function room(over: Partial<HistoryRoom> = {}): HistoryRoom {
  return {
    roomId: 'room1',
    roles: ['bidder'],
    createdAt: NOW - 40 * MINUTE,
    lastSeenAt: NOW - 2 * 60 * MINUTE,
    expiresAt: NOW + 10 * MINUTE,
    lotTitle: 'Signed print, edition of 20',
    lastPriceCents: 54000,
    holdCents: 96000,
    result: 'won',
    paddle: 7,
    name: null,
    receipt: true,
    code: 'K7M2QX',
    ...over,
  };
}

function setup(rooms: HistoryRoom[], over: Partial<HomeScreenProps> = {}) {
  const props: HomeScreenProps = {
    rooms,
    now: NOW,
    checkRoom: () => Promise.resolve('live'),
    onJoin: () => Promise.resolve(true),
    onCreate: vi.fn(),
    onClear: vi.fn(),
    onNavigate: vi.fn(),
    ...over,
  };
  return { props, ...render(<HomeScreen {...props} />) };
}

describe('greeting', () => {
  it('welcomes by name first, then by paddle, then plainly', () => {
    expect(pickGreeting({ name: 'Asha', paddle: 7 }).hello).toBe('Welcome back, Asha.');
    expect(pickGreeting({ name: null, paddle: 7 }).hello).toBe('Welcome back, Paddle 7.');
    expect(pickGreeting({ name: null, paddle: null }).hello).toBe('Welcome back.');
    expect(pickGreeting(null).hello).toBe('Welcome back.');
  });

  it('says how long ago in plain words', () => {
    expect(timeAgo(NOW, NOW)).toBe('Just now');
    expect(timeAgo(NOW - MINUTE, NOW)).toBe('1 minute ago');
    expect(timeAgo(NOW - 5 * MINUTE, NOW)).toBe('5 minutes ago');
    expect(timeAgo(NOW - 60 * MINUTE, NOW)).toBe('1 hour ago');
    expect(timeAgo(NOW - 120 * MINUTE, NOW)).toBe('2 hours ago');
    expect(timeAgo(NOW - 26 * 60 * MINUTE, NOW)).toBe('Yesterday');
    expect(timeAgo(NOW - 72 * 60 * MINUTE, NOW)).toBe('3 days ago');
    expect(timeAgo(NOW + 5 * MINUTE, NOW)).toBe('Just now');
  });
});

describe('Home screen: structure', () => {
  it('has a banner, a main landmark, a footer and one h1 before the h2 sections and h3 tiles', () => {
    setup([room(), room({ roomId: 'room2' })]);
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('contentinfo')).toBeTruthy();
    const levels = screen.getAllByRole('heading').map((h) => h.tagName);
    expect(levels[0]).toBe('H1');
    expect(levels.slice(1).every((l) => l === 'H2' || l === 'H3')).toBe(true);
    expect(levels.indexOf('H3')).toBeGreaterThan(levels.lastIndexOf('H2') - 1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('greets with the paddle, with no sentence or eyebrow around it', () => {
    const { container } = setup([room({ result: 'open' })]);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome back, Paddle 7.');
    expect(container.textContent).not.toMatch(
      /Good (morning|afternoon|evening)|Still up|sale room/i,
    );
  });

  it('marks the logo as the way home and as the current page', () => {
    setup([room()]);
    const logo = screen.getByRole('link', { name: t('home.logoLabel') });
    expect(logo.getAttribute('href')).toBe('/');
    expect(logo.getAttribute('aria-current')).toBe('page');
  });

  it('links to About GAVEL at /about and to the Judge guide', () => {
    const { props } = setup([room()]);
    expect(screen.getByRole('link', { name: t('home.about') }).getAttribute('href')).toBe('/about');
    const nav = within(screen.getByRole('navigation', { name: t('home.nav') }));
    const judge = nav.getByRole('link', { name: 'Judge guide' });
    expect(judge.getAttribute('href')).toBe('/try');
    fireEvent.click(judge);
    expect(props.onNavigate).toHaveBeenCalledWith('/try');
  });

  it('offers four tiles: scripted demo, judge guide, public ledger and docs', () => {
    const { props } = setup([room()]);
    const tiles = within(screen.getByRole('region', { name: t('home.tiles.title') }));
    const hrefs = tiles.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/demo/scripted',
      '/try',
      '/ledger',
      'https://docs.gavel.dualmindlab.tech',
    ]);
    fireEvent.click(tiles.getByRole('link', { name: /Public ledger/ }));
    expect(props.onNavigate).toHaveBeenCalledWith('/ledger');
  });

  it('is honest in the footer and offers Clear', () => {
    const { props } = setup([room()]);
    expect(screen.getByText('Sandbox. No real money moves.')).toBeTruthy();
    expect(screen.getByText('Your history stays in this browser.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear my history' }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });

  it('has no serious accessibility violations', async () => {
    const { container } = setup([room(), room({ roomId: 'room2', result: 'lost' })]);
    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
      resultTypes: ['violations'],
    });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe('Home screen: the last auction', () => {
  it('won: the price, the hold and the plain-words result', () => {
    const { container } = setup([room()]);
    expect(screen.getByText('Signed print, edition of 20')).toBeTruthy();
    expect(screen.getAllByText('$540.00').length).toBeGreaterThan(0);
    expect(screen.getByText('You held $960 and won at $540')).toBeTruthy();
    expect(screen.getByText('2 hours ago')).toBeTruthy();
    expect(screen.getByText('As a bidder, Paddle 7')).toBeTruthy();
    expect(container.querySelector('.gv-home__badge')?.textContent).toBe('Won');
  });

  it('lost', () => {
    setup([room({ result: 'lost' })]);
    expect(screen.getByText('You held $960. Someone else won at $540')).toBeTruthy();
    expect(document.querySelector('.gv-home__badge')?.textContent).toBe('Lost');
  });

  it('stopped', () => {
    setup([room({ result: 'stopped', roles: ['watcher'], paddle: null })]);
    expect(screen.getByText('Stopped by the auctioneer')).toBeTruthy();
    expect(screen.getByText('As a watcher')).toBeTruthy();
  });

  it('closed', () => {
    setup([room({ result: 'closed', roles: ['auctioneer'] })]);
    expect(screen.getByText('Room closed')).toBeTruthy();
    expect(screen.getByText('As the auctioneer')).toBeTruthy();
    expect(document.querySelector('.gv-home__badge')?.textContent).toBe('Closed');
  });

  it('open, and no price yet', () => {
    setup([room({ result: 'open', lastPriceCents: null })]);
    expect(screen.getByText('Still open when you left')).toBeTruthy();
    expect(screen.getByText(t('home.last.noBids'))).toBeTruthy();
    expect(screen.getByText(t('home.last.priceOpen'))).toBeTruthy();
  });

  it('shows the links once the room answers', async () => {
    const { props } = setup([room({ result: 'closed' })]);
    expect(screen.getByText(t('home.room.checking'))).toBeTruthy();
    const receipt = await screen.findByRole('link', { name: 'Open receipt' });
    expect(receipt.getAttribute('href')).toBe('/r/room1/receipt');
    expect(screen.getByRole('link', { name: 'Open ledger' }).getAttribute('href')).toBe(
      '/r/room1/audit',
    );
    expect(screen.getByRole('link', { name: 'Verify the ledger' }).getAttribute('href')).toBe(
      '/verify',
    );
    fireEvent.click(receipt);
    expect(props.onNavigate).toHaveBeenCalledWith('/r/room1/receipt');
  });

  it('offers a way back into a room that is still open', async () => {
    setup([room({ result: 'open', roles: ['auctioneer'] })]);
    expect(
      (await screen.findByRole('link', { name: t('home.link.return') })).getAttribute('href'),
    ).toBe('/r/room1/hub');
  });

  it('leaves out the receipt link before the hammer', async () => {
    setup([room({ result: 'open', receipt: false })]);
    await screen.findByRole('link', { name: 'Open ledger' });
    expect(screen.queryByRole('link', { name: 'Open receipt' })).toBeNull();
  });

  it('a deleted room (host says 404): keeps the summary and says so, with no links', async () => {
    setup([room()], { checkRoom: () => Promise.resolve('gone') });
    await waitFor(() => expect(screen.queryByText(t('home.room.checking'))).toBeNull());
    expect(screen.getByText(/Room deleted after 30 minutes; only this summary stays/)).toBeTruthy();
    expect(screen.getByText('You held $960 and won at $540')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open receipt' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Verify the ledger' })).toBeNull();
  });

  it('a room past its end time is deleted without asking the host, and is not "waiting"', () => {
    const checkRoom = vi.fn(() => Promise.resolve<'live'>('live'));
    setup([room({ result: 'open', expiresAt: NOW - MINUTE })], { checkRoom });
    expect(checkRoom).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Open ledger' })).toBeNull();
    expect(document.querySelector('.gv-home__badge')?.textContent).toBe('Closed');
    expect(screen.getByText('Room closed')).toBeTruthy();
  });

  it('degrades when the host does not answer', async () => {
    setup([room()], { checkRoom: () => Promise.reject(new Error('offline')) });
    expect(await screen.findByText(t('home.room.unknown'))).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open ledger' })).toBeNull();
  });

  it('with no server to ask it shows the summary and no links', () => {
    const { container } = render(
      <HomeScreen
        rooms={[room()]}
        now={NOW}
        onJoin={() => Promise.resolve(true)}
        onCreate={() => undefined}
        onClear={() => undefined}
        onNavigate={() => undefined}
      />,
    );
    expect(container.querySelector('.gv-home__links')).toBeNull();
  });

  it('lists earlier rooms as ruled rows', () => {
    const { container } = setup([
      room(),
      room({
        roomId: 'room2',
        lotTitle: 'Vinyl',
        result: 'lost',
        lastPriceCents: 12000,
        lastSeenAt: NOW - 3 * 24 * 60 * MINUTE,
        expiresAt: NOW - 70 * 60 * MINUTE,
      }),
    ]);
    const list = container.querySelector<HTMLElement>('.gv-home__rows');
    const rows = within(list as HTMLElement).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('Vinyl');
    expect(rows[0]?.textContent).toContain('Lost');
    expect(rows[0]?.textContent).toContain('3 days ago');
    expect(rows[0]?.textContent).toContain(t('home.earlier.deleted'));
  });

  it('shows no earlier section when there is only one room, and the last card spans the row', () => {
    const { container } = setup([room()]);
    expect(screen.queryByText(t('home.earlier.kicker'))).toBeNull();
    expect(container.querySelector('.gv-home__deck--solo')).not.toBeNull();
  });

  it('keeps the caption about deleted rooms inside the last auction card', () => {
    setup([room()]);
    const card = screen.getByRole('region', { name: t('home.last.kicker') });
    expect(within(card).getByText(t('home.last.caption', { minutes: 30 }))).toBeTruthy();
  });

  it('lists the real earlier rooms from the history, newest first, at most four', () => {
    const rooms = [room()];
    for (let i = 0; i < 6; i += 1) {
      rooms.push(
        room({ roomId: `old${i}`, lotTitle: `Lot ${i}`, lastSeenAt: NOW - (i + 3) * 60 * MINUTE }),
      );
    }
    const { container } = setup(rooms);
    const titles = Array.from(container.querySelectorAll('.gv-home__row-title')).map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(['Lot 0', 'Lot 1', 'Lot 2', 'Lot 3']);
    expect(container.querySelector('.gv-home__deck--solo')).toBeNull();
  });
});

describe('Home screen: the two ways in', () => {
  it('Create a room starts the room flow', () => {
    const { props } = setup([room()]);
    fireEvent.click(screen.getByRole('button', { name: /Create a room/ }));
    expect(props.onCreate).toHaveBeenCalledTimes(1);
  });

  it('Join a room opens the code entry and focuses it', () => {
    setup([room()]);
    const join = screen.getByRole('button', { name: /Join a room/ });
    expect(join.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(join);
    expect(join.getAttribute('aria-expanded')).toBe('true');
    const first = screen.getByLabelText(t('ui.code.char', { n: 1, length: 6 }));
    expect(document.activeElement).toBe(first);
  });

  it('joins with a typed code', async () => {
    const onJoin = vi.fn(() => Promise.resolve(true));
    setup([room()], { onJoin });
    fireEvent.click(screen.getByRole('button', { name: /Join a room/ }));
    fireEvent.change(screen.getByLabelText(t('ui.code.char', { n: 1, length: 6 })), {
      target: { value: 'K7M2QX' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(onJoin).toHaveBeenCalledWith('K7M2QX'));
  });

  it('offers recent codes and joins with one', async () => {
    const onJoin = vi.fn(() => Promise.resolve(true));
    setup([room(), room({ roomId: 'room2', code: 'ABCDEF' })], { onJoin });
    fireEvent.click(screen.getByRole('button', { name: /Join a room/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Use code ABCDEF' }));
    await waitFor(() => expect(onJoin).toHaveBeenCalledWith('ABCDEF'));
  });

  it('does not offer the code of a deleted room', () => {
    setup([room({ expiresAt: NOW - MINUTE, code: 'OLDONE' })]);
    fireEvent.click(screen.getByRole('button', { name: /Join a room/ }));
    expect(screen.queryByRole('button', { name: 'Use code OLDONE' })).toBeNull();
  });

  it('opens the room from a pasted join link', async () => {
    const onJoin = vi.fn(() => Promise.resolve(true));
    setup([room()], { onJoin });
    fireEvent.click(screen.getByRole('button', { name: /Join a room/ }));
    const slot = screen.getByLabelText(t('ui.code.char', { n: 1, length: 6 }));
    fireEvent.paste(slot, {
      clipboardData: { getData: () => 'https://gavel-web.example/join/01HXYZROOM' },
    });
    await waitFor(() => expect(onJoin).toHaveBeenCalledWith('01HXYZROOM'));
  });

  it('says so when the code is not a room', async () => {
    setup([room()], { onJoin: () => Promise.resolve(false) });
    fireEvent.click(screen.getByRole('button', { name: /Join a room/ }));
    fireEvent.change(screen.getByLabelText(t('ui.code.char', { n: 1, length: 6 })), {
      target: { value: 'NOROOM' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText(t('landing.codeInvalid'))).toBeTruthy();
  });

  it('tells a lost connection apart from a wrong code', async () => {
    setup([room()], {
      onJoin: () => Promise.reject(new ApiError('unreachable', null)),
    });
    fireEvent.click(screen.getByRole('button', { name: /Join a room/ }));
    fireEvent.change(screen.getByLabelText(t('ui.code.char', { n: 1, length: 6 })), {
      target: { value: 'K7M2QX' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText(t('join.offlineTitle'))).toBeTruthy();
  });
});

describe('Home screen: wording', () => {
  it('never uses the banned money words', () => {
    const { container } = setup([room(), room({ roomId: 'r2', result: 'lost' })]);
    expect(container.textContent).not.toMatch(/\bpay|charged|captur|\bfirst\b|\bfee/i);
  });
});

describe('Home screen: opened from the winner pop-up (UIX-60)', () => {
  it('opens the join field with the code input focused on /?join=1', () => {
    window.history.pushState(null, '', '/?join=1');
    try {
      setup([room()]);
      expect(screen.getByLabelText(t('home.join.codeLabel'))).toBeTruthy();
      expect(document.activeElement?.classList.contains('ui-otp__slot')).toBe(true);
    } finally {
      window.history.pushState(null, '', '/');
    }
  });
});
