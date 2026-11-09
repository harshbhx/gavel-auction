import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { confirmHold } from '../support/approveHold';
import { RegisterScreen } from '../../src/screens/register/RegisterScreen';
import { customCeilingCents, validName } from '../../src/screens/register/validate';

function continueButton(): HTMLElement {
  return screen.getByRole('button', { name: t('reg.continue') });
}

function setup(props: Partial<Parameters<typeof RegisterScreen>[0]> = {}) {
  const onApprove = vi.fn();
  render(<RegisterScreen minCents={10000} maxCents={100000} onApprove={onApprove} {...props} />);
  return onApprove;
}

describe('registration validation (T-WEB-031)', () => {
  it('validates names', () => {
    expect(validName('')).toBe(false);
    expect(validName('   ')).toBe(false);
    expect(validName('a'.repeat(24))).toBe(true);
    expect(validName('a'.repeat(25))).toBe(false);
  });

  it('accepts a custom ceiling only inside the room range', () => {
    expect(customCeilingCents('99', 10000, 100000)).toBeNull();
    expect(customCeilingCents('100', 10000, 100000)).toBe(10000);
    expect(customCeilingCents('1000', 10000, 100000)).toBe(100000);
    expect(customCeilingCents('1001', 10000, 100000)).toBeNull();
  });

  it('enables Continue only when the name is valid and has no paddle field', () => {
    setup();
    expect(continueButton().getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
    expect(continueButton().getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByLabelText(t('reg.paddle'))).toBeNull();
  });

  it('shows the held block with the amount before approval is enabled', () => {
    const onApprove = setup();
    fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
    fireEvent.click(continueButton());

    const approve = (): HTMLElement => screen.getByRole('button', { name: t('reg.approve') });
    expect(approve().getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByTestId('held-block')).toBeNull();

    fireEvent.click(screen.getByLabelText('$250'));
    const block = screen.getByTestId('held-block');
    expect(block.textContent).toContain(t('reg.heldNotCharged'));
    expect(block.textContent).toContain(t('reg.heldExplain', { amount: '$250' }));
    expect(approve().getAttribute('aria-disabled')).toBeNull();

    expect(onApprove).not.toHaveBeenCalled();
    confirmHold();
    expect(onApprove).toHaveBeenCalledWith({ name: 'Priya', ceilingCents: 25000 });
  });

  it('shows an inline range error for an out of range custom ceiling', () => {
    setup();
    fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
    fireEvent.click(continueButton());
    const field = screen.getByRole('textbox', { name: t('reg.custom') });
    fireEvent.change(field, { target: { value: '1001' } });
    fireEvent.blur(field);
    expect(screen.getByRole('alert').textContent).toContain(
      t('reg.overCap', { max: '$1,000' }),
    );
    expect(screen.queryByTestId('held-block')).toBeNull();
  });
});

describe('ceiling slider', () => {
  it('moves the ceiling and keeps whole-dollar cents', () => {
    const onApprove = setup();
    fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
    fireEvent.click(continueButton());
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'End' });
    expect(screen.getByTestId('held-block').textContent).toContain('$1,000');
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    confirmHold();
    expect(onApprove).toHaveBeenCalledTimes(1);
    const draft = onApprove.mock.calls[0]?.[0] as { ceilingCents: number };
    expect(draft.ceilingCents % 100).toBe(0);
    expect(draft.ceilingCents).toBeLessThan(100000);
  });
});
