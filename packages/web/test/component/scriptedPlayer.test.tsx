import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { BEATS, BEAT_MS } from '../../src/screens/demo/scriptedBeats';
import { centeredScrollTop, useScriptedPlayback } from '../../src/screens/demo/ScriptedPlayer';
import { happy } from '../../src/testing/scenarios/happy';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

function reducedMotion(on: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: on && query.includes('reduce'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe('scripted demo beats', () => {
  it('are readable: each beat is 2 to 4 seconds at 1x and still 1 second at 2x', () => {
    expect(BEAT_MS).toBeGreaterThanOrEqual(2000);
    expect(BEAT_MS).toBeLessThanOrEqual(4000);
    expect(BEAT_MS / 2).toBeGreaterThanOrEqual(1000);
  });

  it('cover the story in order: hold, bids, hammer, capture, receipt', () => {
    const stages = BEATS.map((b) => b.stage);
    expect(stages[0]).toBe('hold');
    expect(stages).toContain('outbid');
    expect(stages.indexOf('hammer')).toBeGreaterThan(stages.lastIndexOf('outbid'));
    expect(stages.indexOf('capture')).toBeGreaterThan(stages.indexOf('hammer'));
    expect(stages[stages.length - 1]).toBe('receipt');
    const times = BEATS.map((b) => b.at);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('land on real frame times of the happy scenario', () => {
    const frameTimes = new Set(happy.steps.map((s) => s.at));
    for (const beat of BEATS) expect(frameTimes.has(beat.at)).toBe(true);
  });
});

describe('useScriptedPlayback', () => {
  it('moves one beat per interval at 1x and faster at 1.25x without restarting the beat', () => {
    vi.useFakeTimers();
    reducedMotion(false);
    const { result } = renderHook(() => useScriptedPlayback());
    expect(result.current.beat).toBe(0);
    expect(result.current.playing).toBe(true);
    act(() => {
      vi.advanceTimersByTime(BEAT_MS - 1);
    });
    expect(result.current.beat).toBe(0);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.beat).toBe(1);
    act(() => {
      vi.advanceTimersByTime(BEAT_MS / 2);
    });
    // Half the beat is spent at 1x; the other half now takes 1/1.25 as long in real time.
    act(() => result.current.setSpeed(1.25));
    act(() => {
      vi.advanceTimersByTime(BEAT_MS / 2 / 1.25 - 1);
    });
    expect(result.current.beat).toBe(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.beat).toBe(2);
  });

  it('pauses, steps and restarts', () => {
    vi.useFakeTimers();
    reducedMotion(false);
    const { result } = renderHook(() => useScriptedPlayback());
    act(() => result.current.toggle());
    expect(result.current.playing).toBe(false);
    act(() => {
      vi.advanceTimersByTime(BEAT_MS * 3);
    });
    expect(result.current.beat).toBe(0);
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.beat).toBe(2);
    act(() => result.current.prev());
    expect(result.current.beat).toBe(1);
    expect(result.current.startAt).toBe(BEATS[1]?.at);
    act(() => result.current.restart());
    expect(result.current.beat).toBe(0);
    expect(result.current.playing).toBe(true);
  });

  it('stops on the last beat and offers to play again', () => {
    vi.useFakeTimers();
    reducedMotion(false);
    const { result } = renderHook(() => useScriptedPlayback());
    for (let i = 0; i < BEATS.length + 2; i += 1) {
      act(() => {
        vi.advanceTimersByTime(BEAT_MS);
      });
    }
    expect(result.current.beat).toBe(BEATS.length - 1);
    expect(result.current.playing).toBe(false);
    expect(result.current.finished).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.beat).toBe(0);
    expect(result.current.playing).toBe(true);
  });

  it('waits for the viewer under reduced motion', () => {
    vi.useFakeTimers();
    reducedMotion(true);
    const { result } = renderHook(() => useScriptedPlayback());
    expect(result.current.reduced).toBe(true);
    expect(result.current.playing).toBe(false);
    act(() => {
      vi.advanceTimersByTime(BEAT_MS * 4);
    });
    expect(result.current.beat).toBe(0);
    act(() => result.current.next());
    expect(result.current.beat).toBe(1);
  });
});

describe('/demo/scripted player', () => {
  it('shows a simulated label, a caption, controls and the step list', async () => {
    reducedMotion(true);
    render(<App initialPath="/demo/scripted" gallery={false} />);
    await waitFor(() => expect(screen.getByText(t('prov.scripted'))).toBeTruthy());
    expect(screen.getByText(t('scriptedDemo.banner'))).toBeTruthy();
    expect(screen.getByTestId('scripted-progress').textContent).toBe(
      t('scriptedDemo.progress', { n: 1, total: BEATS.length }),
    );
    expect(screen.getByTestId('scripted-caption').textContent).toContain(
      t('scriptedDemo.b0.label'),
    );
    for (const name of ['play', 'next', 'prev', 'restart'] as const) {
      expect(screen.getByRole('button', { name: t(`scriptedDemo.${name}`) })).toBeTruthy();
    }
    const steps = screen.getByRole('list', { name: t('scriptedDemo.steps') });
    expect(steps.querySelectorAll('li')).toHaveLength(BEATS.length);
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toContain(
      t('scriptedDemo.b0.label'),
    );
    expect(screen.getByText(t('scriptedDemo.reduced'))).toBeTruthy();
  });

  it('steps one beat at a time and the price follows the step', async () => {
    reducedMotion(true);
    render(<App initialPath="/demo/scripted" gallery={false} />);
    await waitFor(() => expect(screen.getByText(t('prov.scripted'))).toBeTruthy());
    const next = screen.getByRole('button', { name: t('scriptedDemo.next') });
    fireEvent.click(next);
    expect(screen.getByTestId('scripted-caption').textContent).toContain(t('scriptedDemo.b1.body'));
    await waitFor(() => expect(screen.getByTestId('screen-price').textContent).toContain('50.00'));
    fireEvent.click(next);
    await waitFor(() => expect(screen.getByTestId('screen-price').textContent).toContain('150.00'));
    expect(screen.getByTestId('scripted-progress').textContent).toBe(
      t('scriptedDemo.progress', { n: 3, total: BEATS.length }),
    );
    fireEvent.click(screen.getByRole('button', { name: t('scriptedDemo.restart') }));
    expect(screen.getByTestId('scripted-progress').textContent).toBe(
      t('scriptedDemo.progress', { n: 1, total: BEATS.length }),
    );
    await waitFor(() => expect(screen.queryByTestId('screen-price')).toBeNull());
  });

  it('offers 1x, 1.25x, 1.5x and 2x as a pressed-state group, 1x first, and remembers it', async () => {
    reducedMotion(true);
    const { unmount } = render(<App initialPath="/demo/scripted" gallery={false} />);
    await waitFor(() => expect(screen.getByText(t('prov.scripted'))).toBeTruthy());
    const group = screen.getByRole('group', { name: t('scriptedDemo.speed') });
    const buttons = group.querySelectorAll('button');
    expect(Array.from(buttons).map((b) => b.textContent)).toEqual(['1x', '1.25x', '1.5x', '2x']);
    const named = (x: string) =>
      screen.getByRole('button', { name: t('scriptedDemo.speedOption', { speed: x }) });
    expect(named('1x').getAttribute('aria-pressed')).toBe('true');
    const before = screen.getByTestId('scripted-duration').textContent;
    fireEvent.click(named('1.25x'));
    expect(named('1.25x').getAttribute('aria-pressed')).toBe('true');
    expect(named('1x').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('scripted-duration').textContent).not.toBe(before);
    // Recording strip is unchanged by the speed.
    expect(screen.getByText(t('scriptedDemo.banner'))).toBeTruthy();
    unmount();
    render(<App initialPath="/demo/scripted" gallery={false} />);
    await waitFor(() => expect(screen.getByText(t('prov.scripted'))).toBeTruthy());
    expect(named('1.25x').getAttribute('aria-pressed')).toBe('true');
  });

  it('falls back to 1x when session storage is blocked', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    reducedMotion(false);
    const { result } = renderHook(() => useScriptedPlayback());
    expect(result.current.speed).toBe(1);
    act(() => result.current.setSpeed(2));
    expect(result.current.speed).toBe(2);
  });

  it('jumps to a step from the step list', async () => {
    reducedMotion(true);
    render(<App initialPath="/demo/scripted" gallery={false} />);
    await waitFor(() => expect(screen.getByText(t('prov.scripted'))).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('scriptedDemo.b6.label')) }));
    expect(screen.getByTestId('scripted-caption').textContent).toContain(
      t('scriptedDemo.b6.label'),
    );
    await waitFor(() => expect(screen.getByTestId('sold')).toBeTruthy());
  });

  it('puts the step list in a focusable, labelled scroll region that follows the current step', async () => {
    reducedMotion(true);
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    });
    render(<App initialPath="/demo/scripted" gallery={false} />);
    const region = await screen.findByRole('region', { name: t('scriptedDemo.stepsRegion') });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.querySelectorAll('li').length).toBe(BEATS.length);
    expect(region.contains(screen.getByRole('list', { name: t('scriptedDemo.steps') }))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: t('scriptedDemo.next') }));
    await waitFor(() => expect(region.querySelector('[data-status="now"]')).toBeTruthy());
    delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
  });
});

describe('centeredScrollTop', () => {
  function box(top: number, extra: Partial<HTMLElement> = {}): HTMLElement {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ top }) as DOMRect;
    for (const [k, v] of Object.entries(extra)) {
      Object.defineProperty(el, k, { value: v, configurable: true, writable: true });
    }
    return el;
  }

  it('centres the item by its position in the list, not its offsetTop', () => {
    // List top at y=500, scrolled 100; item top at y=700 (200 below list top), 40 tall.
    const list = box(500, { scrollTop: 100, clientHeight: 225, scrollHeight: 2000 });
    // offsetTop is relative to a far-away positioned ancestor and must be ignored.
    const item = box(700, { offsetHeight: 40, offsetTop: 9999 });
    expect(centeredScrollTop(list, item)).toBe(100 + 200 - (225 - 40) / 2);
  });

  it('clamps to the scrollable range', () => {
    const list = box(0, { scrollTop: 0, clientHeight: 200, scrollHeight: 300 });
    expect(centeredScrollTop(list, box(0, { offsetHeight: 40 }))).toBe(0);
    expect(centeredScrollTop(list, box(5000, { offsetHeight: 40 }))).toBe(100);
  });
});
