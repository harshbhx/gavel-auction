import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Announcer } from '../../src/a11y/Announcer';
import { createAnnouncerCore, type AnnouncerCore } from '../../src/a11y/announce';

let core: AnnouncerCore;

beforeEach(() => {
  vi.useFakeTimers();
  core = createAnnouncerCore();
});

afterEach(() => {
  core.dispose();
  vi.useRealTimers();
});

function seen(): string[] {
  const out: string[] = [];
  core.subscribe(() => out.push(core.getState().polite));
  return out;
}

describe('polite queue (T-WEB-052)', () => {
  it('turns 10 price updates in 1 s into at most 1 polite announcement', () => {
    const out = seen();
    for (let i = 0; i < 10; i += 1) {
      core.announce('polite', `Price is now ${i}`, 'price');
      vi.advanceTimersByTime(100);
    }
    expect(out).toEqual(['Price is now 0']);
  });

  it('announces only the latest price after the gap', () => {
    const out = seen();
    for (let i = 0; i < 5; i += 1) core.announce('polite', `Price is now ${i}`, 'price');
    vi.advanceTimersByTime(2000);
    expect(out).toEqual(['Price is now 0', 'Price is now 4']);
  });

  it('keeps a 2000 ms gap between different messages', () => {
    const out = seen();
    core.announce('polite', 'one', 'outbid');
    core.announce('polite', 'two', 'summary');
    expect(out).toEqual(['one']);
    vi.advanceTimersByTime(1999);
    expect(out).toEqual(['one']);
    vi.advanceTimersByTime(1);
    expect(out).toEqual(['one', 'two']);
  });

  it('drops the oldest when more than 3 are waiting', () => {
    const out = seen();
    core.announce('polite', 'first', 'summary');
    for (const text of ['a', 'b', 'c', 'd']) core.announce('polite', text, 'ladder');
    core.announce('polite', 'e');
    core.announce('polite', 'f');
    core.announce('polite', 'g');
    vi.advanceTimersByTime(20_000);
    expect(out[0]).toBe('first');
    expect(out.slice(1)).toEqual(['e', 'f', 'g']);
  });

  it('drops an exact repeat of the last queued message', () => {
    core.announce('polite', 'x', 'summary');
    expect(core.announce('polite', 'y')).toBe(true);
    expect(core.announce('polite', 'y')).toBe(false);
  });
});

describe('assertive messages', () => {
  it('speaks immediately, ignoring the polite gap', () => {
    core.announce('polite', 'busy', 'summary');
    core.announce('assertive', 'Auction stopped.', 'stop');
    expect(core.getState().assertive).toBe('Auction stopped.');
  });

  it('dedupes an identical message inside the window and allows it after', () => {
    expect(core.announce('assertive', 'Auction stopped.', 'stop')).toBe(true);
    expect(core.announce('assertive', 'Auction stopped.', 'stop')).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(core.announce('assertive', 'Auction stopped.', 'stop')).toBe(true);
  });
});

describe('partial transcripts', () => {
  it('are rejected at runtime', () => {
    // @ts-expect-error partial transcript keys are not announceable
    expect(core.announce('polite', 'three hun', 'stt_partial')).toBe(false);
    // @ts-expect-error partial transcript keys are not announceable
    expect(core.announce('assertive', 'three hun', 'partial')).toBe(false);
    expect(core.getState()).toEqual({ polite: '', assertive: '', politeSeq: 0, assertiveSeq: 0 });
  });

  it('ignores empty text', () => {
    expect(core.announce('polite', '   ')).toBe(false);
  });
});

describe('Announcer component repeats', () => {
  it('mutates the live region node for an identical assertive message', () => {
    render(<Announcer core={core} />);
    act(() => {
      core.announce('assertive', 'Bid not accepted.', 'bid_rejected');
    });
    const first = screen.getByTestId('live-assertive').firstElementChild;
    act(() => {
      vi.advanceTimersByTime(5000);
      core.announce('assertive', 'Bid not accepted.', 'bid_rejected');
    });
    const second = screen.getByTestId('live-assertive').firstElementChild;
    expect(second).not.toBe(first);
    expect(second?.textContent).toBe('Bid not accepted.');
  });

  it('mutates the polite region node for an identical keyed message', () => {
    render(<Announcer core={core} />);
    act(() => {
      core.announce('polite', 'You have been outbid. Current price $460.', 'outbid');
    });
    const first = screen.getByTestId('live-polite').firstElementChild;
    act(() => {
      vi.advanceTimersByTime(2000);
      core.announce('polite', 'You have been outbid. Current price $460.', 'outbid');
      vi.advanceTimersByTime(2000);
    });
    const second = screen.getByTestId('live-polite').firstElementChild;
    expect(second).not.toBe(first);
  });
});

describe('Announcer component', () => {
  it('renders two live regions that follow the core', () => {
    render(<Announcer core={core} />);
    expect(screen.getByTestId('live-polite').getAttribute('aria-live')).toBe('polite');
    expect(screen.getByTestId('live-assertive').getAttribute('aria-live')).toBe('assertive');
    act(() => {
      core.announce('polite', 'Price is now $350.00. Paddle 12 is leading.', 'price');
      core.announce('assertive', 'Auction stopped.', 'stop');
    });
    expect(screen.getByTestId('live-polite').textContent).toContain('Paddle 12');
    expect(screen.getByTestId('live-assertive').textContent).toBe('Auction stopped.');
  });
});
