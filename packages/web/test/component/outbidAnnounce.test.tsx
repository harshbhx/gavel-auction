import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const announce = vi.fn();
vi.mock('../../src/a11y/announce', () => ({ announce: (...a: unknown[]) => announce(...a) }));

import { useOutbid } from '../../src/screens/bid/useOutbid';

function Probe({ status, cents }: { status: string; cents: number }) {
  useOutbid(status, cents);
  return null;
}

describe('outbid announcement price (#2118)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    announce.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('says the price the header shows after A=$10, B=$15', () => {
    const { rerender } = render(<Probe status="leading" cents={1000} />);
    // The status flips first, the price frame follows in the same tick.
    rerender(<Probe status="outbid" cents={1000} />);
    rerender(<Probe status="outbid" cents={1500} />);
    act(() => void vi.runAllTimers());
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce.mock.calls[0]?.[1]).toBe('You have been outbid. Current price $15.00.');
  });

  it('never announces $0.00 while the price is still unknown', () => {
    const { rerender } = render(<Probe status="leading" cents={0} />);
    rerender(<Probe status="outbid" cents={0} />);
    act(() => void vi.runAllTimers());
    expect(announce).not.toHaveBeenCalled();
    rerender(<Probe status="outbid" cents={1500} />);
    act(() => void vi.runAllTimers());
    expect(announce.mock.calls[0]?.[1]).toContain('$15.00');
  });
});
