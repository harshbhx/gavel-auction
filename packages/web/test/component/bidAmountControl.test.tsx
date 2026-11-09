import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { BidScreen } from '../../src/screens/bid/BidScreen';
import { CustomBid, centsToText, sliderMax, stepAmount } from '../../src/screens/bid/CustomBid';
import { LotBlock } from '../../src/screens/bid/LotBlock';
import { RoomStore } from '../../src/store/roomStore';
import { bidderId, openSnapshot, roster, stateMsg } from '../../src/testing/builders';

afterEach(cleanup);

describe('stepAmount and sliderMax', () => {
  it('starts at the next minimum and steps by the increment', () => {
    expect(stepAmount(null, 1, 5000, 500, 20000)).toBe(5000);
    expect(stepAmount(5000, 1, 5000, 500, 20000)).toBe(5500);
    expect(stepAmount(5500, -1, 5000, 500, 20000)).toBe(5000);
  });

  it('never goes under the next minimum or above the limit', () => {
    expect(stepAmount(5000, -1, 5000, 500, 20000)).toBe(5000);
    expect(stepAmount(1000, 1, 5000, 500, 20000)).toBe(5000);
    expect(stepAmount(19900, 1, 5000, 500, 20000)).toBe(20000);
    expect(stepAmount(20000, 1, 5000, 500, 20000)).toBe(20000);
  });

  it('never steps to an amount below the minimum when the limit is under it (#2396)', () => {
    expect(stepAmount(null, 1, 10500, 500, 10000)).toBe(10500);
    expect(stepAmount(null, -1, 10500, 500, 10000)).toBe(10500);
  });

  it('puts the slider top on the step ladder under the limit', () => {
    expect(sliderMax(5000, 500, 20000)).toBe(20000);
    expect(sliderMax(5000, 700, 20000)).toBe(19700);
    expect(sliderMax(5000, 500, 4000)).toBeNull();
    expect(sliderMax(5000, 500, null)).toBeNull();
  });

  it('writes whole dollars plainly and others with cents', () => {
    expect(centsToText(5500)).toBe('55');
    expect(centsToText(5550)).toBe('55.50');
  });
});

function setup(ceiling: number | null = 20000, onBid = vi.fn()) {
  render(
    <CustomBid nextMinCents={5000} incrementCents={500} ceilingCents={ceiling} onBid={onBid} />,
  );
  const box = screen.getByRole('textbox', { name: t('bid.custom') }) as HTMLInputElement;
  return { box, onBid };
}

describe('CustomBid stepper and slider', () => {
  it('steps with the buttons and the arrow keys, down to the minimum and up to the limit', () => {
    const { box } = setup(6000);
    const up = screen.getByRole('button', { name: t('bid.step.up', { amount: '$5' }) });
    const down = screen.getByRole('button', { name: t('bid.step.down', { amount: '$5' }) });
    fireEvent.click(up);
    expect(box.value).toBe('50');
    fireEvent.click(up);
    expect(box.value).toBe('55');
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(box.value).toBe('60');
    expect(up.getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.value).toBe('50');
    expect(down.getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps the slider and the box in sync both ways', () => {
    const { box } = setup();
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.min).toBe('5000');
    expect(slider.max).toBe('20000');
    expect(slider.step).toBe('500');
    expect(slider.getAttribute('aria-valuetext')).toBe('$50.00');
    fireEvent.change(slider, { target: { value: '9000' } });
    expect(box.value).toBe('90');
    fireEvent.click(screen.getByRole('button', { name: t('bid.step.up', { amount: '$5' }) }));
    expect(slider.value).toBe('9500');
    fireEvent.change(box, { target: { value: '120' } });
    expect(slider.value).toBe('12000');
  });

  it('clamps the slider to the limit when the typed amount is over it', () => {
    const { box } = setup(10000);
    fireEvent.change(box, { target: { value: '500' } });
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('10000');
  });

  it('has no slider when the limit is at or under the next minimum', () => {
    setup(5000);
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('sends the stepped amount with Place bid', () => {
    const { onBid } = setup();
    fireEvent.click(screen.getByRole('button', { name: t('bid.step.up', { amount: '$5' }) }));
    fireEvent.click(screen.getByRole('button', { name: t('bid.step.up', { amount: '$5' }) }));
    fireEvent.click(screen.getByRole('button', { name: t('bid.place') }));
    expect(onBid).toHaveBeenCalledWith(5500);
  });
});

describe('LotBlock and the bid screen lot', () => {
  it('shows an image with alt text, the name and the fallback story', () => {
    render(<LotBlock title="Signed press plate" />);
    expect(screen.getByRole('img', { name: t('bid.lot.alt') })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Signed press plate' })).toBeTruthy();
    expect(screen.getByText(t('bid.lot.story'))).toBeTruthy();
  });

  it('falls back to the catalog name and prefers a story from the room', () => {
    render(<LotBlock title={null} story="Pulled in 1923." />);
    expect(screen.getByRole('heading', { name: t('bid.lot.fallbackName') })).toBeTruthy();
    expect(screen.getByText('Pulled in 1923.')).toBeTruthy();
  });

  it('is on the bidder screen with the stepper under the room limit', () => {
    const store = new RoomStore();
    const snap = {
      ...openSnapshot(roster([12, 'Priya'])),
      you: { bidderId: bidderId(12), ceiling: 30000 },
    };
    store.dispatch({ kind: 'wire', msg: stateMsg(1, snap as never) }, 0);
    render(<BidScreen store={store} onBid={vi.fn()} />);
    expect(screen.getByTestId('lot-block')).toBeTruthy();
    expect(screen.getByRole('slider')).toBeTruthy();
  });
});

describe('CustomBid when the limit is under the next minimum (#2396)', () => {
  it('leaves the steppers and Place bid inert and writes nothing', () => {
    const { box, onBid } = setup(4000);
    const up = screen.getByRole('button', { name: t('bid.step.up', { amount: '$5' }) });
    const down = screen.getByRole('button', { name: t('bid.step.down', { amount: '$5' }) });
    const place = screen.getByRole('button', { name: t('bid.place') });
    for (const b of [up, down, place]) expect(b.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(up);
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    fireEvent.click(place);
    expect(onBid).not.toHaveBeenCalled();
  });
});
