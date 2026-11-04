import { render, type RenderResult } from '@testing-library/react';
import { App } from '../App';
import { ScenarioTransport } from '../net/scenarioTransport';
import type { Scenario } from '../net/transport';
import type { SettlementView } from '../ladder/ladderModel';
import { RoomStore } from '../store/roomStore';

export interface RenderWithScenarioOptions {
  /**
   * Index into `scenario.steps` of the last step to apply. Steps are applied in time order up to
   * and including that step. Defaults to the last step. Use -1 to apply none.
   */
  atStep?: number;
  /** Whether /gallery exists in this render. */
  gallery?: boolean;
}

export interface ScenarioRender extends RenderResult {
  store: RoomStore;
  transport: ScenarioTransport;
  /** Most recent settlement detail delivered so far, or null before the first update. */
  settlementView: SettlementView | null;
}

/**
 * Renders the app at `route` with a scenario played into a fresh room store, stopped after
 * `atStep`. No timers and no network: the same scenario and step always give the same state.
 */
export function renderWithScenario(
  route: string,
  scenario: Scenario,
  options: RenderWithScenarioOptions = {},
): ScenarioRender {
  const store = new RoomStore();
  const transport = new ScenarioTransport(scenario);
  let settlements = 0;
  transport.onMessage((msg) => {
    if (msg.t === 'settlement_update') settlements += 1;
    store.dispatch({ kind: 'wire', msg }, 0);
  });
  transport.connect();

  const last = scenario.steps.length - 1;
  const atStep = Math.min(options.atStep ?? last, last);
  const until = scenario.steps.slice(0, atStep + 1).reduce((max, s) => Math.max(max, s.at), 0);
  if (atStep >= 0) transport.advance(until);

  const views = scenario.settlementViews ?? [];
  const settlementView = settlements === 0 ? null : (views[settlements - 1] ?? null);

  const rendered = render(<App initialPath={route} gallery={options.gallery ?? true} />);
  return { ...rendered, store, transport, settlementView };
}
