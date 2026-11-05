import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { RegisterScreen } from '../../src/screens/register/RegisterScreen';
import { customCeilingCents, parsePaddle, validName } from '../../src/screens/register/validate';

function continueButton(): HTMLElement {
  return screen.getByRole('button', { name: t('reg.continue') });
}

function setup(props: Partial<Parameters<typeof RegisterScreen>[0]> = {}) {
  const onApprove = vi.fn();
  render(
    <RegisterScreen
      suggestedPaddle={12}
      minCents={10000}
      maxCents={100000}
      onApprove={onApprove}
      {...props}
    />,
  );
  return onApprove;
}

describe('registration validation (T-WEB-031)', () => {
  it('validates names and paddles', () => {
    expect(validName('')).toBe(false);
    expect(validName('   ')).toBe(false);
    expect(validName('a'.repeat(24))).toBe(true);
    expect(validName('a'.repeat(25))).toBe(false);
    expect(parsePaddle('0')).toBeNull();
    expect(parsePaddle('1')).toBe(1);
    expect(parsePaddle('999')).toBe(999);
    expect(parsePaddle('1000')).toBeNull();
  });

  it('accepts a custom ceiling only inside the room range', () => {
    expect(customCeilingCents('99', 10000, 100000)).toBeNull();
    expect(customCeilingCents('100', 10000, 100000)).toBe(10000);
    expect(customCeilingCents('1000', 10000, 100000)).toBe(100000);
    expect(customCeilingCents('1001', 10000, 100000)).toBeNull();
  });

  it('enables Continue only when name and paddle are valid', () => {
    setup();
    expect(continueButton().getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
    expect(continueButton().getAttribute('aria-disabled')).toBeNull();
    fireEvent.change(screen.getByLabelText(t('reg.paddle')), { target: { value: '1000' } });
    expect(continueButton().getAttribute('aria-disabled')).toBe('true');
  });

  it('shows a taken paddle error tied to the field by aria-describedby', () => {
    setup({ paddleTaken: { taken: 12, suggested: 13 } });
    const input = screen.getByLabelText(t('reg.paddle'));
    const text = t('reg.paddleTaken', { n: 12, m: 13 });
    const error = screen.getByText(text);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(error.parentElement?.id ?? 'missing');
  });

  it('shows the held block with the amount before approval is enabled', () => {
    const onApprove = setup();
    fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
    fireEvent.click(continueButton());

    const approve = screen.getByRole('button', { name: t('reg.approve') });
    expect(approve.getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByTestId('held-block')).toBeNull();

    fireEvent.click(screen.getByLabelText('$250'));
    const block = screen.getByTestId('held-block');
    expect(block.textContent).toContain(t('reg.heldNotCharged'));
    expect(block.textContent).toContain(t('reg.heldExplain', { amount: '$250' }));
    expect(approve.getAttribute('aria-disabled')).toBeNull();

    fireEvent.click(approve);
    expect(onApprove).toHaveBeenCalledWith({ name: 'Priya', paddle: 12, ceilingCents: 25000 });
  });

  it('shows an inline range error for an out of range custom ceiling', () => {
    setup();
    fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
    fireEvent.click(continueButton());
    fireEvent.click(screen.getByLabelText(t('reg.custom')));
    const field = screen.getByRole('textbox', { name: t('reg.custom') });
    fireEvent.change(field, { target: { value: '1001' } });
    fireEvent.blur(field);
    expect(screen.getByRole('alert').textContent).toContain(
      t('reg.customRange', { min: '$100', max: '$1,000' }),
    );
    expect(screen.queryByTestId('held-block')).toBeNull();
  });
});
