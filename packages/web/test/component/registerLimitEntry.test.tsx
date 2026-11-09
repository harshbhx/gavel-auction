import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { confirmHold } from '../support/approveHold';
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
