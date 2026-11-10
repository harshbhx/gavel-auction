import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { confirmHold } from '../support/approveHold';
import { RegisterScreen } from '../../src/screens/register/RegisterScreen';
import { NAME_MAX, customCeilingCents, validName } from '../../src/screens/register/validate';

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
    expect(validName('a'.repeat(64))).toBe(true);
    expect(validName('a'.repeat(65))).toBe(false);
  });

  it('accepts a 30 character name and the input limit equals the enforced one (#2391)', () => {
    setup();
    const input = screen.getByLabelText(t('reg.name')) as HTMLInputElement;
    expect(input.maxLength).toBe(NAME_MAX);
    fireEvent.change(input, { target: { value: 'Dr. Elizabeth Montgomery-Smith' } });
    expect(continueButton().getAttribute('aria-disabled')).toBeNull();
  });

  it('says what is wrong with a name, never the generic error (#2391)', () => {
    setup();
    const input = screen.getByLabelText(t('reg.name'));
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toContain(t('reg.nameRequired'));
    expect(screen.queryByText(t('generic.error'))).toBeNull();
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
    expect(screen.getByTestId('held-block').textContent).not.toContain('The rest is released');

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
    expect(screen.getByRole('alert').textContent).toContain(t('reg.overCap', { max: '$1,000' }));
    expect(screen.getByTestId('held-block').textContent).not.toContain('The rest is released');
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

describe('registration reasons for disabled buttons', () => {
  it('says why Continue is off while the name is empty', () => {
    setup();
    expect(screen.getByTestId('continue-reason').textContent).toBe(t('reg.continueReason'));
    fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
    expect(screen.queryByTestId('continue-reason')).toBeNull();
  });

  it('says why Approve is off until a limit is chosen and shows the held block with the range', () => {
    setup();
    fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
    fireEvent.click(continueButton());
    expect(screen.getByText(t('reg.chooseFirst'))).toBeTruthy();
    expect(screen.getByTestId('held-block').textContent).toContain(
      t('reg.heldExplainRange', { min: '$100', max: '$1,000' }),
    );
    fireEvent.click(screen.getByLabelText('$250'));
    expect(screen.queryByText(t('reg.chooseFirst'))).toBeNull();
  });
});
