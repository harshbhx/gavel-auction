import { describe, expect, it } from 'vitest';
import { renderWithScenario } from '../../src/testing/renderWithScenario';
import { happy } from '../../src/testing/scenarios/happy';

describe('renderWithScenario', () => {
  it('applies no steps with atStep -1 and all steps by default', () => {
    const none = renderWithScenario('/r/r1/bid', happy, { atStep: -1 });
    expect(none.transport.elapsedMs).toBe(0);
    none.unmount();
    const all = renderWithScenario('/r/r1/bid', happy);
    expect(all.store.getState().snapshot).not.toBeNull();
  });

  it('is deterministic for the same step', () => {
    const a = renderWithScenario('/r/r1/bid', happy, { atStep: 5 });
    const b = renderWithScenario('/r/r1/bid', happy, { atStep: 5 });
    expect(a.store.getState()).toEqual(b.store.getState());
  });

  it('exposes the settlement view once settlement has started', () => {
    const early = renderWithScenario('/r/r1/audit', happy, { atStep: 0 });
    expect(early.settlementView).toBeNull();
    early.unmount();
    const done = renderWithScenario('/r/r1/audit', happy);
    expect(done.settlementView?.phase).toBe('CAPTURED');
  });

  it('renders the route', () => {
    const view = renderWithScenario('/nope', happy);
    expect(view.container.querySelector('[data-route="notFound"]')).not.toBeNull();
  });
});
