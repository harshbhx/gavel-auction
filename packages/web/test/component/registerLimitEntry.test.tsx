import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { confirmHold } from '../support/approveHold';
import { sliderStops } from '../../src/ui/format';
import { RegisterScreen, sliderMax } from '../../src/screens/register/RegisterScreen';

function toLimitStep(props: Partial<Parameters<typeof RegisterScreen>[0]> = {}) {
  const onApprove = vi.fn();
  render(
    <RegisterScreen
      minCents={10_000}
      maxCents={500_000}
      presetsCents={[10_000, 50_000]}
      onApprove={onApprove}
      {...props}
    />,
  );
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
    expect(box.value).toBe('1,000');
    expect(slider.getAttribute('aria-valuenow')).toBe('100000');
  });

  it('stretches the slider range to a typed limit, up to the cap', () => {
    const { box, slider } = toLimitStep();
    expect(slider.getAttribute('aria-valuemax')).toBe('100000');
    fireEvent.change(box, { target: { value: '3000' } });
    expect(slider.getAttribute('aria-valuemax')).toBe('300000');
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(slider.getAttribute('aria-valuemax')).toBe('300000');
    fireEvent.change(box, { target: { value: '9000' } });
    expect(slider.getAttribute('aria-valuemax')).toBe('500000');
  });

  it('says the real cap when the limit is above it and blocks the hold', () => {
    const { onApprove, box } = toLimitStep();
    fireEvent.change(box, { target: { value: '5001' } });
    expect(screen.getByRole('alert').textContent).toContain(t('reg.overCap', { max: '$5,000' }));
    expect(screen.queryByTestId('held-block')).toBeNull();
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

  it('computes the slider top', () => {
    expect(sliderMax(100, 100_000, [10_000], null)).toBe(100_000);
    expect(sliderMax(100, 500_000, [10_000], 250_000)).toBe(250_000);
    expect(sliderMax(100, 500_000, [10_000], 900_000)).toBe(500_000);
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
    const { box, slider } = toLimitStep({ minCents: 50_100, maxCents: 100_000, presetsCents: [] });
    fireEvent.keyDown(slider, { key: 'End' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(box.value).toBe('975');
    fireEvent.keyDown(slider, { key: 'Home' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(box.value).toBe('525');
  });

  it('follows bounds that arrive after the first render (#2395)', () => {
    const props = { onApprove: vi.fn(), presetsCents: [10_000, 50_000] };
    const { rerender } = render(<RegisterScreen minCents={100} maxCents={100_000} {...props} />);
    fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
    fireEvent.click(screen.getByRole('button', { name: t('reg.continue') }));
    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('aria-valuemax')).toBe('100000');
    rerender(
      <RegisterScreen
        minCents={150_000}
        maxCents={500_000}
        presetsCents={[150_000, 300_000]}
        onApprove={props.onApprove}
      />,
    );
    expect(slider.getAttribute('aria-valuemin')).toBe('150000');
    expect(slider.getAttribute('aria-valuemax')).toBe('300000');
  });
});
