import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { BEATS, BEAT_MS } from '../../src/screens/demo/scriptedBeats';
import { useScriptedPlayback } from '../../src/screens/demo/ScriptedPlayer';
import { happy } from '../../src/testing/scenarios/happy';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
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
  it('are readable: each beat is 2 to 4 seconds at 1x and slower at slow', () => {
    expect(BEAT_MS.normal).toBeGreaterThanOrEqual(2000);
    expect(BEAT_MS.normal).toBeLessThanOrEqual(4000);
    expect(BEAT_MS.slow).toBeGreaterThan(BEAT_MS.normal);
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
  it('moves one beat per interval at 1x and slower at slow speed', () => {
    vi.useFakeTimers();
    reducedMotion(false);
    const { result } = renderHook(() => useScriptedPlayback());
    expect(result.current.beat).toBe(0);
    expect(result.current.playing).toBe(true);
    act(() => {
      vi.advanceTimersByTime(BEAT_MS.normal - 1);
    });
    expect(result.current.beat).toBe(0);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.beat).toBe(1);
    act(() => result.current.setSpeed('slow'));
    act(() => {
      vi.advanceTimersByTime(BEAT_MS.normal);
    });
    expect(result.current.beat).toBe(1);
    act(() => {
      vi.advanceTimersByTime(BEAT_MS.slow - BEAT_MS.normal);
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
      vi.advanceTimersByTime(BEAT_MS.slow * 3);
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
    act(() => {
      vi.advanceTimersByTime(BEAT_MS.normal * (BEATS.length + 2));
    });
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
      vi.advanceTimersByTime(BEAT_MS.slow * 4);
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

  it('toggles speed with pressed state, 1x first', async () => {
    reducedMotion(true);
    render(<App initialPath="/demo/scripted" gallery={false} />);
    await waitFor(() => expect(screen.getByText(t('prov.scripted'))).toBeTruthy());
    const normal = screen.getByRole('button', { name: t('scriptedDemo.speedNormal') });
    const slow = screen.getByRole('button', { name: t('scriptedDemo.speedSlow') });
    expect(normal.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(slow);
    expect(slow.getAttribute('aria-pressed')).toBe('true');
    expect(normal.getAttribute('aria-pressed')).toBe('false');
  });

  it('jumps to a step from the step list', async () => {
    reducedMotion(true);
    render(<App initialPath="/demo/scripted" gallery={false} />);
    await waitFor(() => expect(screen.getByText(t('prov.scripted'))).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('scriptedDemo.b6.label')) }));
    expect(screen.getByTestId('scripted-caption').textContent).toContain(t('scriptedDemo.b6.label'));
    await waitFor(() => expect(screen.getByTestId('sold')).toBeTruthy());
  });
});
