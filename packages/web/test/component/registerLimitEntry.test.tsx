import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { confirmHold } from '../support/approveHold';
import { sliderStops } from '../../src/ui/format';
import { rangePresets } from '../../src/screens/register/LimitEntry';
import { RegisterScreen } from '../../src/screens/register/RegisterScreen';

function toLimitStep(props: Partial<Parameters<typeof RegisterScreen>[0]> = {}) {
  const onApprove = vi.fn();
  render(<RegisterScreen minCents={10_000} maxCents={500_000} onApprove={onApprove} {...props} />);
  fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
  fireEvent.click(screen.getByRole('button', { name: t('reg.continue') }));
  const box = screen.getByRole('textbox', { name: t('reg.custom') }) as HTMLInputElement;
  return { onApprove, box, slider: screen.getByRole('slider') };
}

describe('limit box and slider (UIX-44)', () => {
  it('shows the box without picking Custom first', () => {
    const { box } = toLimitStep();
    expect(box.getAttribute('inputmode')).toBe('numeric');
  });

  it('moves the slider when a limit is typed, and formats the box', () => {
    const { box, slider } = toLimitStep();
    fireEvent.change(box, { target: { value: '750' } });
    expect(box.value).toBe('750');
    expect(slider.getAttribute('aria-valuenow')).toBe('75000');
    fireEvent.change(box, { target: { value: '2,5ab00' } });
    expect(box.value).toBe('2,500');
    expect(slider.getAttribute('aria-valuenow')).toBe('250000');
  });

  it('moves the box when the slider moves', () => {
    const { box, slider } = toLimitStep();
    fireEvent.keyDown(slider, { key: 'End' });
    expect(box.value).toBe('5,000');
    expect(slider.getAttribute('aria-valuenow')).toBe('500000');
  });

  it('stretches the slider range to a typed limit, up to the cap', () => {
    const { box, slider } = toLimitStep();
    expect(slider.getAttribute('aria-valuemax')).toBe('500000');
    fireEvent.change(box, { target: { value: '3000' } });
    expect(slider.getAttribute('aria-valuemax')).toBe('500000');
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(slider.getAttribute('aria-valuemax')).toBe('500000');
    fireEvent.change(box, { target: { value: '9000' } });
    expect(slider.getAttribute('aria-valuemax')).toBe('500000');
  });

  it('says the real cap when the limit is above it and blocks the hold', () => {
    const { onApprove, box } = toLimitStep();
    fireEvent.change(box, { target: { value: '5001' } });
    expect(screen.getByRole('alert').textContent).toContain(t('reg.overCap', { max: '$5,000' }));
    expect(screen.getByTestId('held-block').textContent).not.toContain('The rest is released');
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('sends the typed limit through the unchanged approve flow', () => {
    const { onApprove, box } = toLimitStep();
    fireEvent.change(box, { target: { value: '3000' } });
    confirmHold();
    expect(onApprove).toHaveBeenCalledWith({ name: 'Priya', ceilingCents: 300_000 });
  });

  it('fills the box when a preset is chosen', () => {
    const { box } = toLimitStep();
    fireEvent.click(screen.getByLabelText('$500'));
    expect(box.value).toBe('500');
  });

  it('offers exactly four presets from the room range, no extra typed-value button', () => {
    toLimitStep();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.parentElement?.textContent)).toEqual([
      '$100',
      '$500',
      '$2,500',
      '$5,000',
    ]);
    const { box } = {
      box: screen.getByRole('textbox', { name: t('reg.custom') }) as HTMLInputElement,
    };
    fireEvent.change(box, { target: { value: '1234' } });
    expect(screen.getAllByRole('radio')).toHaveLength(4);
  });

  it('computes presets as about 1%, 10%, 50% and 100% of the cap', () => {
    expect(rangePresets(1_000, 5_000_000)).toEqual([50_000, 500_000, 2_500_000, 5_000_000]);
    expect(rangePresets(100, 10_000_000)).toEqual([100_000, 1_000_000, 5_000_000, 10_000_000]);
    // Small ranges scale down the same way and never leave [min, max].
    expect(rangePresets(1_000, 5_000)).toEqual([1_000, 2_500, 5_000]);
    expect(rangePresets(100, 10_000)).toEqual([100, 1_000, 5_000, 10_000]);
    // An odd cap: the top pick is the cap itself, the others stay clean and inside the range.
    expect(rangePresets(100, 1_760_000)).toEqual([20_000, 200_000, 1_000_000, 1_760_000]);
    for (const [min, max] of [
      [1_000, 5_000_000],
      [150_000, 500_000],
      [100, 100],
    ] as const) {
      const picks = rangePresets(min, max);
      expect(picks.length).toBeLessThanOrEqual(4);
      expect(new Set(picks).size).toBe(picks.length);
      for (const p of picks) {
        expect(p).toBeGreaterThanOrEqual(min);
        expect(p).toBeLessThanOrEqual(max);
      }
    }
  });
});

describe('slider ladder and live bounds (#2393, #2395)', () => {
  it('rests on round amounts when the minimum is odd, ends included (#2393)', () => {
    expect(sliderStops(50_100, 100_000, 2_500)).toEqual([
      50_100, 52_500, 55_000, 57_500, 60_000, 62_500, 65_000, 67_500, 70_000, 72_500, 75_000,
      77_500, 80_000, 82_500, 85_000, 87_500, 90_000, 92_500, 95_000, 97_500, 100_000,
    ]);
    expect(sliderStops(10_000, 100_000, 5_000)[1]).toBe(15_000);
  });

  it('lets a preset inside the range be reached as well (#2393)', () => {
    expect(sliderStops(50_100, 100_000, 2_500, [60_000, 71_000, 20_000])).toContain(71_000);
    expect(sliderStops(50_100, 100_000, 2_500, [20_000])).not.toContain(20_000);
  });

  it('lands on a round amount with End then ArrowLeft and with Home then ArrowRight (#2393)', () => {
    const { box, slider } = toLimitStep({ minCents: 50_100, maxCents: 100_000 });
    fireEvent.keyDown(slider, { key: 'End' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(box.value).toBe('975');
    fireEvent.keyDown(slider, { key: 'Home' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(box.value).toBe('525');
  });

  it('follows bounds that arrive after the first render (#2395)', () => {
    const props = { onApprove: vi.fn() };
    const { rerender } = render(<RegisterScreen minCents={100} maxCents={100_000} {...props} />);
    fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
    fireEvent.click(screen.getByRole('button', { name: t('reg.continue') }));
    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('aria-valuemax')).toBe('100000');
    rerender(<RegisterScreen minCents={150_000} maxCents={500_000} onApprove={props.onApprove} />);
    expect(slider.getAttribute('aria-valuemin')).toBe('150000');
    expect(slider.getAttribute('aria-valuemax')).toBe('500000');
  });
});

describe('open limit above $1,000 (UIX-59)', () => {
  const BIG = {
    minCents: 100,
    maxCents: 10_000_000,
  };

  it('accepts a typed limit above $1,000 up to the room cap and sends it', () => {
    const { onApprove, box, slider } = toLimitStep(BIG);
    fireEvent.change(box, { target: { value: '50000' } });
    expect(box.value).toBe('50,000');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(slider.getAttribute('aria-valuenow')).toBe('5000000');
    confirmHold();
    expect(onApprove).toHaveBeenCalledWith({ name: 'Priya', ceilingCents: 5_000_000 });
  });

  it('accepts exactly the cap and refuses one dollar over it', () => {
    const { onApprove, box } = toLimitStep(BIG);
    fireEvent.change(box, { target: { value: '100001' } });
    expect(screen.getByRole('alert').textContent).toContain(t('reg.overCap', { max: '$100,000' }));
    expect(onApprove).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: '100000' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the slider top and the hint on the same real cap while typing', () => {
    const { onApprove, box, slider } = toLimitStep(BIG);
    expect(slider.getAttribute('aria-valuemax')).toBe('10000000');
    expect(screen.getByText(t('reg.customHint', { min: '$1', max: '$100,000' }))).toBeTruthy();
    fireEvent.change(box, { target: { value: '12500' } });
    expect(slider.getAttribute('aria-valuemax')).toBe('10000000');
    confirmHold();
    expect(onApprove).toHaveBeenCalledWith({ name: 'Priya', ceilingCents: 1_250_000 });
  });

  it('parks the slider at the cap and keeps the message while the limit is over it', () => {
    const { box, slider } = toLimitStep(BIG);
    fireEvent.change(box, { target: { value: '150000' } });
    expect(slider.getAttribute('aria-valuemax')).toBe('10000000');
    expect(slider.getAttribute('aria-valuenow')).toBe('10000000');
    expect(screen.getByRole('alert').textContent).toContain('$100,000');
  });
});
