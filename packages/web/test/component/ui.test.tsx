import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CeilingSlider,
  HoldButton,
  HoldCard,
  JoinCodeInput,
  Loader,
  PaletteSwitch,
  PriceRoll,
  Skeleton,
  SkeletonGroup,
  StatusPill,
  clearPalette,
  initPalette,
  normalizeCode,
  setPalette,
} from '../../src/ui';
import { changedIndexes, snapToStep } from '../../src/ui/format';

function setReducedMotion(on: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({ matches: on && query.includes('reduce'), media: query }),
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
  vi.useRealTimers();
});

describe('HoldButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const advance = (ms: number): void => {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  };

  it('confirms once after a 3 second pointer hold', () => {
    const onConfirm = vi.fn();
    render(<HoldButton label="Hold to bid" onConfirm={onConfirm} />);
    const btn = screen.getByRole('button', { name: /hold to bid/i });
    fireEvent.pointerDown(btn);
    advance(2900);
    expect(onConfirm).not.toHaveBeenCalled();
    advance(200);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    advance(5000);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancels when released early and says so', () => {
    const onConfirm = vi.fn();
    render(<HoldButton label="Hold to bid" onConfirm={onConfirm} />);
    const btn = screen.getByRole('button', { name: /hold to bid/i });
    fireEvent.pointerDown(btn);
    advance(2000);
    fireEvent.pointerUp(btn);
    advance(3000);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toMatch(/released too early/i);
  });

  it('announces the seconds left while holding in a polite live region', () => {
    render(<HoldButton label="Hold to bid" onConfirm={() => undefined} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: /hold to bid/i }));
    advance(1200);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toMatch(/holding\. 2 seconds to go/i);
  });

  it('supports holding with Space and cancels on key up', () => {
    const onConfirm = vi.fn();
    render(<HoldButton label="Hold to bid" onConfirm={onConfirm} />);
    const btn = screen.getByRole('button', { name: /hold to bid/i });
    fireEvent.keyDown(btn, { key: ' ' });
    advance(1000);
    fireEvent.keyUp(btn, { key: ' ' });
    advance(4000);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.keyDown(btn, { key: 'Enter' });
    fireEvent.keyDown(btn, { key: 'Enter', repeat: true });
    advance(3100);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('ignores a plain click', () => {
    const onConfirm = vi.fn();
    render(<HoldButton label="Hold to bid" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /hold to bid/i }));
    advance(4000);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('offers two taps for people who cannot hold', () => {
    const onConfirm = vi.fn();
    render(<HoldButton label="Hold to bid" onConfirm={onConfirm} />);
    const alt = screen.getByRole('button', { name: /cannot hold/i });
    fireEvent.click(alt);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /tap again to confirm/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('drops the two-tap arm after 5 seconds', () => {
    const onConfirm = vi.fn();
    render(<HoldButton label="Hold to bid" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /cannot hold/i }));
    advance(5100);
    fireEvent.click(screen.getByRole('button', { name: /cannot hold/i }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('can hide the alternative', () => {
    render(<HoldButton label="Hold" onConfirm={() => undefined} confirmAlternative={false} />);
    expect(screen.queryByRole('button', { name: /cannot hold/i })).toBeNull();
  });

  it('does nothing while disabled and exposes aria-disabled', () => {
    const onConfirm = vi.fn();
    render(<HoldButton label="Hold to bid" onConfirm={onConfirm} disabled />);
    const btn = screen.getByRole('button', { name: /hold to bid/i });
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    fireEvent.pointerDown(btn);
    advance(4000);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('moves the ring in whole seconds under reduced motion but still needs the full hold', () => {
    setReducedMotion(true);
    const onConfirm = vi.fn();
    render(<HoldButton label="Hold to bid" onConfirm={onConfirm} />);
    const btn = screen.getByRole('button', { name: /hold to bid/i });
    fireEvent.pointerDown(btn);
    advance(1500);
    expect(btn.style.getPropertyValue('--ui-hold-p')).toBe(String(1 / 3));
    expect(onConfirm).not.toHaveBeenCalled();
    advance(1600);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('PriceRoll', () => {
  it('exposes the amount as an image label and uses tabular numerals', () => {
    render(<PriceRoll cents={35000} />);
    const price = screen.getByRole('img', { name: '$350.00' });
    expect(price.className).toContain('ui-price');
  });

  it('rolls only the digits that changed, then settles', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<PriceRoll cents={35000} />);
    expect(container.querySelectorAll('.ui-price__dg--roll')).toHaveLength(0);
    rerender(<PriceRoll cents={40000} />);
    expect(container.querySelectorAll('.ui-price__dg--roll')).toHaveLength(2);
    expect(screen.getByRole('img', { name: '$400.00' })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.querySelectorAll('.ui-price__dg--roll')).toHaveLength(0);
  });

  it('swaps at once under reduced motion', () => {
    setReducedMotion(true);
    const { container, rerender } = render(<PriceRoll cents={35000} />);
    rerender(<PriceRoll cents={40000} />);
    expect(container.querySelectorAll('.ui-price__dg--roll')).toHaveLength(0);
    expect(container.textContent).toBe('$400.00');
  });

  it('finds the changed character positions', () => {
    expect(changedIndexes(35000, 35050)).toEqual([5]);
    expect(changedIndexes(99900, 100000).length).toBe(9);
  });
});

describe('HoldCard', () => {
  it('shows a held hold with hatched bar and plain text', () => {
    const { container } = render(<HoldCard state="held" ceilingCents={50000} />);
    expect(screen.getByText('Held', { selector: 'em' })).toBeTruthy();
    expect(screen.getByText(/not charged/i)).toBeTruthy();
    expect(container.querySelector('.ui-holdbar__held')).not.toBeNull();
    expect(container.querySelector('.ui-holdbar__charged')).toBeNull();
  });

  it('shows the charge solid and the rest hollow', () => {
    const { container } = render(
      <HoldCard state="charged" ceilingCents={50000} chargedCents={35000} />,
    );
    expect(screen.getByText('Charged', { selector: 'em' })).toBeTruthy();
    expect(screen.getByText(/charged \$350\.00\. \$150\.00 released/i)).toBeTruthy();
    expect(container.querySelector('.ui-holdbar__charged')).not.toBeNull();
    expect(container.querySelector('.ui-holdbar__released')).not.toBeNull();
  });

  it('shows a released hold as hollow only', () => {
    const { container } = render(<HoldCard state="released" ceilingCents={50000} />);
    expect(screen.getByText('Released', { selector: 'em' })).toBeTruthy();
    expect(container.querySelector('.ui-holdbar__released--full')).not.toBeNull();
    expect(container.querySelector('.ui-holdbar__held')).toBeNull();
  });

  it('hides and shows the amount', () => {
    render(<HoldCard state="held" ceilingCents={50000} />);
    const toggle = screen.getByRole('button', { name: /hide amount/i });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('img', { name: 'Amount hidden' })).toBeTruthy();
    expect(screen.queryByText(/\$500\.00/)).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getAllByRole('img', { name: /\$500\.00/ }).length).toBeGreaterThan(0);
  });
});

describe('CeilingSlider', () => {
  const props = { min: 10000, max: 100000, step: 5000 };

  it('exposes slider semantics with a money value text', () => {
    render(<CeilingSlider {...props} value={50000} onChange={() => undefined} />);
    const slider = screen.getByRole('slider', { name: /price ceiling/i });
    expect(slider.getAttribute('aria-valuemin')).toBe('10000');
    expect(slider.getAttribute('aria-valuemax')).toBe('100000');
    expect(slider.getAttribute('aria-valuenow')).toBe('50000');
    expect(slider.getAttribute('aria-valuetext')).toBe('$500');
  });

  it('draws a tick per step', () => {
    const { container } = render(
      <CeilingSlider {...props} value={50000} onChange={() => undefined} />,
    );
    expect(container.querySelectorAll('.ui-slider__tick')).toHaveLength(19);
    expect(container.querySelectorAll('.ui-slider__tick--major')).toHaveLength(10);
  });

  it('moves by key and clamps at the ends', () => {
    const onChange = vi.fn();
    render(<CeilingSlider {...props} value={50000} onChange={onChange} />);
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(55000);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(45000);
    fireEvent.keyDown(slider, { key: 'PageUp' });
    expect(onChange).toHaveBeenLastCalledWith(75000);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(10000);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(100000);
  });

  it('snaps a pointer position to the nearest tick', () => {
    const onChange = vi.fn();
    render(<CeilingSlider {...props} value={50000} onChange={onChange} />);
    const slider = screen.getByRole('slider');
    slider.getBoundingClientRect = () =>
      ({ left: 0, width: 200, top: 0, height: 56, right: 200, bottom: 56, x: 0, y: 0 }) as DOMRect;
    fireEvent.pointerDown(slider, { clientX: 100, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(55000);
  });

  it('does not change while disabled', () => {
    const onChange = vi.fn();
    render(<CeilingSlider {...props} value={50000} onChange={onChange} disabled />);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('snapToStep clamps and rounds', () => {
    expect(snapToStep(12400, 10000, 100000, 5000)).toBe(10000);
    expect(snapToStep(12600, 10000, 100000, 5000)).toBe(15000);
    expect(snapToStep(999999, 10000, 100000, 5000)).toBe(100000);
    expect(snapToStep(-5, 10000, 100000, 5000)).toBe(10000);
  });
});

function Code({ onComplete }: { onComplete?: (code: string) => void }) {
  const [value, setValue] = useState('');
  return <JoinCodeInput value={value} onChange={setValue} onComplete={onComplete} />;
}

describe('JoinCodeInput', () => {
  const slots = (): HTMLInputElement[] => screen.getAllByRole('textbox') as HTMLInputElement[];

  it('has one labelled slot per character', () => {
    render(<Code />);
    expect(slots()).toHaveLength(4);
    expect(screen.getByLabelText('Character 1 of 4')).toBeTruthy();
    expect(screen.getByRole('group', { name: /room code, 4 characters after GVL-/i })).toBeTruthy();
  });

  it('upper-cases, fills a slot and moves to the next', () => {
    render(<Code />);
    const [first, second] = slots();
    first?.focus();
    fireEvent.change(first as HTMLInputElement, { target: { value: 'k' } });
    expect((first as HTMLInputElement).value).toBe('K');
    expect(document.activeElement).toBe(second);
  });

  it('fills every slot from pasted text, drops the prefix and completes', () => {
    const onComplete = vi.fn();
    render(<Code onComplete={onComplete} />);
    fireEvent.paste(slots()[0] as HTMLInputElement, {
      clipboardData: { getData: () => 'gvl-4k7q' },
    });
    expect(
      slots()
        .map((s) => s.value)
        .join(''),
    ).toBe('4K7Q');
    expect(onComplete).toHaveBeenCalledWith('4K7Q');
  });

  it('backspace on an empty slot clears the previous one and moves back', () => {
    render(<Code />);
    fireEvent.paste(slots()[0] as HTMLInputElement, {
      clipboardData: { getData: () => '4K7' },
    });
    const third = slots()[2] as HTMLInputElement;
    expect(third.value).toBe('7');
    const fourth = slots()[3] as HTMLInputElement;
    fourth.focus();
    fireEvent.keyDown(fourth, { key: 'Backspace' });
    expect(
      slots()
        .map((s) => s.value)
        .join(''),
    ).toBe('4K');
    expect(document.activeElement).toBe(third);
  });

  it('arrow keys move between slots', () => {
    render(<Code />);
    const [first, second] = slots();
    (first as HTMLInputElement).focus();
    fireEvent.keyDown(first as HTMLInputElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second as HTMLInputElement, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(first);
  });

  it('marks the field invalid and announces the message', () => {
    render(<JoinCodeInput value="" onChange={() => undefined} invalid message="No such room" />);
    expect(screen.getByRole('alert').textContent).toBe('No such room');
    expect(slots()[0]?.getAttribute('aria-invalid')).toBe('true');
  });

  it('normalizes pasted codes', () => {
    expect(normalizeCode('GVL-4K7Q', 'GVL-', 4)).toBe('4K7Q');
    expect(normalizeCode(' 4k 7q ', 'GVL-', 4)).toBe('4K7Q');
    expect(normalizeCode('4K7QXX', 'GVL-', 4)).toBe('4K7Q');
  });
});

describe('Loader, Skeleton and StatusPill', () => {
  it('Loader is a status with a text label', () => {
    render(<Loader label="Loading lot" />);
    expect(screen.getByRole('status').textContent).toBe('Loading lot');
  });

  it('SkeletonGroup announces busy once and hides the blocks', () => {
    const { container } = render(
      <SkeletonGroup label="Loading lot">
        <Skeleton height="150px" />
        <Skeleton width="70%" />
        <Skeleton circle />
      </SkeletonGroup>,
    );
    const group = screen.getByRole('status', { name: 'Loading lot' });
    expect(group.getAttribute('aria-busy')).toBe('true');
    const blocks = container.querySelectorAll('.ui-skeleton');
    expect(blocks).toHaveLength(3);
    blocks.forEach((b) => {
      expect(b.getAttribute('aria-hidden')).toBe('true');
    });
  });

  it('StatusPill carries its meaning in text, with the tone as data', () => {
    render(<StatusPill tone="win">You lead</StatusPill>);
    const pill = screen.getByText('You lead');
    expect(pill.getAttribute('data-tone')).toBe('win');
  });
});

describe('palette', () => {
  beforeEach(() => {
    clearPalette();
  });

  it('stores the pick and sets data-pal', () => {
    setPalette('c');
    expect(document.documentElement.getAttribute('data-pal')).toBe('c');
    expect(window.localStorage.getItem('gavel.palette')).toBe('c');
  });

  it('applies the stored pick at start-up and ignores junk', () => {
    window.localStorage.setItem('gavel.palette', 'b');
    expect(initPalette()).toBe('b');
    expect(document.documentElement.getAttribute('data-pal')).toBe('b');
    clearPalette();
    window.localStorage.setItem('gavel.palette', 'zzz');
    expect(initPalette()).toBeNull();
    expect(document.documentElement.hasAttribute('data-pal')).toBe(false);
  });

  it('survives blocked storage', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(initPalette()).toBeNull();
    expect(() => {
      setPalette('a');
    }).not.toThrow();
    expect(document.documentElement.getAttribute('data-pal')).toBe('a');
    spy.mockRestore();
    set.mockRestore();
  });

  it('PaletteSwitch buttons switch and show the pressed one', () => {
    render(<PaletteSwitch />);
    fireEvent.click(screen.getByRole('button', { name: 'Night Board' }));
    expect(screen.getByRole('button', { name: 'Night Board' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(document.documentElement.getAttribute('data-pal')).toBe('b');
  });
});
