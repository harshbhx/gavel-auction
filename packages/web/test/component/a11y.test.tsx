import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import type { SettlementView } from '../../src/ladder/ladderModel';
import { ScenarioTransport } from '../../src/net/scenarioTransport';
import type { Scenario } from '../../src/net/transport';
import { AuditTable } from '../../src/screens/audit/AuditTable';
import { BidScreen } from '../../src/screens/bid/BidScreen';
import { ConsoleScreen } from '../../src/screens/console/ConsoleScreen';
import { JoinScreen, type JoinState } from '../../src/screens/join/JoinScreen';
import { LandingScreen, type LandingStatus } from '../../src/screens/landing/LandingScreen';
import { Receipt } from '../../src/screens/receipt/Receipt';
import { RegisterScreen } from '../../src/screens/register/RegisterScreen';
import { ScreenView } from '../../src/screens/screen/ScreenView';
import { Empty, ErrorPanel, Loading, Offline } from '../../src/screens/states/States';
import type { DataView } from '../../src/screens/states/statesTable';
import { RoomStore } from '../../src/store/roomStore';
import { bidId, bidderId, openSnapshot, roster, stateMsg } from '../../src/testing/builders';
import { ambiguous_confirm } from '../../src/testing/scenarios/ambiguous_confirm';
import { big_room_200_bids } from '../../src/testing/scenarios/big_room_200_bids';
import { failed_needs_review } from '../../src/testing/scenarios/failed_needs_review';
import { happy } from '../../src/testing/scenarios/happy';
import { kill_switch } from '../../src/testing/scenarios/kill_switch';
import { late_entry_closed } from '../../src/testing/scenarios/late_entry_closed';
import { outbid_race } from '../../src/testing/scenarios/outbid_race';
import { reconnect_gap } from '../../src/testing/scenarios/reconnect_gap';
import { rejections } from '../../src/testing/scenarios/rejections';
import { soft_close } from '../../src/testing/scenarios/soft_close';
import { winner_declined_fallback } from '../../src/testing/scenarios/winner_declined_fallback';
import type { AuditPayload } from '../../src/wire';

afterEach(() => {
  window.sessionStorage.clear();
});

// Static role and name audit (names, labels, ids, headings), then an axe-core pass further down.
const ROUTES: readonly string[] = [
  '/',
  '/demo',
  '/try',
  '/verify',
  '/join/r1',
  '/r/r1/register',
  '/r/r1/bid',
  '/r/r1/receipt',
  '/r/r1/console',
  '/r/r1/screen',
  '/r/r1/audit',
  '/replay/abc',
  '/gallery',
  '/nope/at/all',
];

function nameOf(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label !== null && label.trim().length > 0) return label.trim();
  const by = el.getAttribute('aria-labelledby');
  if (by !== null) {
    const text = by
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (text.length > 0) return text;
  }
  return (el.textContent ?? '').trim();
}

describe.each(ROUTES)('a11y structure %s', (path) => {
  it('has exactly one h1 and no empty headings', () => {
    const { container } = render(<App initialPath={path} gallery />);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    for (const h of Array.from(container.querySelectorAll('h1,h2,h3,h4'))) {
      expect((h.textContent ?? '').trim().length).toBeGreaterThan(0);
    }
  });

  it('gives every button and link an accessible name', () => {
    const { container } = render(<App initialPath={path} gallery />);
    for (const el of Array.from(container.querySelectorAll('button,a[href],[role="button"]'))) {
      const title = el.getAttribute('title') ?? '';
      expect(nameOf(el).length + title.length).toBeGreaterThan(0);
    }
  });

  it('labels every form control', () => {
    const { container } = render(<App initialPath={path} gallery />);
    const controls = container.querySelectorAll('input:not([type="hidden"]),select,textarea');
    for (const el of Array.from(controls)) {
      const id = el.getAttribute('id');
      const labelled =
        (id !== null && container.querySelector(`label[for="${id}"]`) !== null) ||
        el.closest('label') !== null ||
        nameOf(el).length > 0;
      expect(labelled).toBe(true);
    }
  });

  it('has unique ids and hides decorative svg from assistive tech', () => {
    const { container } = render(<App initialPath={path} gallery />);
    const ids = Array.from(container.querySelectorAll('[id]')).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const svg of Array.from(container.querySelectorAll('svg'))) {
      const hidden =
        svg.getAttribute('aria-hidden') === 'true' || svg.closest('[aria-hidden="true"]') !== null;
      const named = nameOf(svg).length > 0 || svg.getAttribute('role') === 'img';
      expect(hidden || named).toBe(true);
    }
  });

  it('gives images a text alternative', () => {
    const { container } = render(<App initialPath={path} gallery />);
    for (const img of Array.from(container.querySelectorAll('img'))) {
      expect(img.hasAttribute('alt')).toBe(true);
    }
  });
});

// axe-core pass (T-WEB-051): zero serious or critical violations on every screen in every state.
// Colour contrast needs real layout, so it is checked in the browser spec and in contrast.test.ts.
async function seriousViolations(node: Element): Promise<string[]> {
  const result = await axe.run(node, {
    rules: { 'color-contrast': { enabled: false } },
    resultTypes: ['violations'],
  });
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

function playScenario(scenario: Scenario): RoomStore {
  const store = new RoomStore();
  const transport = new ScenarioTransport(scenario);
  transport.onMessage((msg) => store.dispatch({ kind: 'wire', msg }, 0));
  transport.connect();
  transport.advance(scenario.steps.reduce((max, s) => Math.max(max, s.at), 0));
  return store;
}

const SCENARIOS: readonly Scenario[] = [
  happy,
  outbid_race,
  soft_close,
  rejections,
  ambiguous_confirm,
  winner_declined_fallback,
  failed_needs_review,
  kill_switch,
  reconnect_gap,
  late_entry_closed,
  big_room_200_bids,
];

describe.each(ROUTES)('axe on route %s', (path) => {
  it('has no serious or critical violations', async () => {
    const { container } = render(<App initialPath={path} gallery />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe('axe on the landing and join screens', () => {
  const noop = (): void => undefined;
  const statuses: readonly LandingStatus[] = ['default', 'busy', 'down'];

  it.each(statuses)('landing in the %s state', async (status) => {
    const { container } = render(
      <LandingScreen
        status={status}
        onStart={noop}
        onJoin={() => Promise.resolve(true)}
        onScripted={noop}
      />,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });

  const joinStates: readonly JoinState[] = ['loading', 'open', 'ended', 'notFound', 'full'];

  it.each(joinStates)('join in the %s state', async (state) => {
    const { container } = render(
      <JoinScreen
        roomId="room1"
        roomName={state === 'open' ? 'Gala' : null}
        shortCode={state === 'open' ? 'ABC123' : null}
        state={state}
        origin="https://gavel.example"
        onNavigate={noop}
        hasSession={false}
      />,
    );
    if (state === 'open') await screen.findByRole('img');
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe('axe on the registration and bid screens', () => {
  it('registration', async () => {
    const { container } = render(
      <RegisterScreen minCents={10000} maxCents={100000} onApprove={vi.fn()} />,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });

  const bidStates: ReadonlyArray<[string, Partial<Parameters<typeof BidScreen>[0]>, number]> = [
    ['open', {}, 50000],
    ['above the ceiling', {}, 6000],
    ['pending', { pending: true }, 50000],
    ['rejected', { rejection: { reason: 'below_increment', mid: 'm1' } }, 50000],
    ['unsent', { unsent: true, onResend: vi.fn() }, 50000],
  ];

  it.each(bidStates)('bid, %s', async (_name, extra, ceiling) => {
    const store = new RoomStore();
    const snap = {
      ...openSnapshot(roster([12, 'Priya'], [7, 'Sam'])),
      you: { bidderId: bidderId(12), ceiling },
    };
    store.dispatch({ kind: 'wire', msg: stateMsg(1, snap as never) }, 0);
    const { container } = render(<BidScreen store={store} onBid={vi.fn()} {...extra} />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe.each(SCENARIOS.map((s) => [s.name, s] as const))(
  'axe on scenario %s',
  (_name, scenario) => {
    it('console', async () => {
      const { container } = render(
        <ConsoleScreen store={playScenario(scenario)} settlementView={null} wide />,
      );
      expect(await seriousViolations(container)).toEqual([]);
    });

    it('public screen', async () => {
      const { container } = render(
        <ScreenView
          lotTitle="Lot"
          code="ABC123"
          joinUrl="https://gavel.example/j"
          store={playScenario(scenario)}
        />,
      );
      expect(await seriousViolations(container)).toEqual([]);
    });

    it('receipt for every settlement view', async () => {
      const views: readonly SettlementView[] = scenario.settlementViews ?? [];
      for (const view of views) {
        const { container, unmount } = render(
          <Receipt view={view} paddle={view.winnerPaddle} itemName="Vase" at={1_700_000_000_000} />,
        );
        expect(await seriousViolations(container)).toEqual([]);
        unmount();
      }
    });
  },
);

describe('axe on the audit and state screens', () => {
  const rows = [1, 2, 3].map(
    (seq) =>
      ({
        bidId: bidId(seq),
        bidderId: bidderId(12),
        source: 'manual',
        outcome: seq === 2 ? 'rejected' : 'accepted',
        serverTs: 1_700_000_000_000 + seq,
        seq,
        parsedAmount: seq * 5000,
      }) as AuditPayload,
  );

  it('audit table, empty and filled', async () => {
    const empty = render(<AuditTable rows={[]} paddleOf={() => 12} />);
    expect(await seriousViolations(empty.container)).toEqual([]);
    empty.unmount();
    const filled = render(<AuditTable rows={rows} paddleOf={() => 12} />);
    expect(await seriousViolations(filled.container)).toEqual([]);
  });

  const views: readonly DataView[] = ['audit', 'receipt', 'roster', 'bids', 'voice', 'replay'];

  it.each(views)('loading, empty, offline and error for %s', async (view) => {
    const { container } = render(
      <>
        <Loading view={view} />
        <Empty view={view} />
        <Offline view={view} />
        <ErrorPanel view={view} onRetry={vi.fn()} code="fake_code" correlationId="fake-ref-0001" />
      </>,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });
});
