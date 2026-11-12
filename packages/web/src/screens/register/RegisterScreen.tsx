import { useState, type FormEvent } from 'react';

import { WideAside } from '../WideAside';
import { announce } from '../../a11y/announce';
import { t } from '../../copy/t';
import { FakePaymentsLabel } from '../../design/FakePaymentsLabel';
import { Icon } from '../../design/icons';
import { Button } from '../../design/primitives/Button';
import { Field } from '../../design/primitives/Field';
import { formatUsdCompact } from '../../util/money';
import { HoldButton } from '../../ui';
import '../flows.css';
import { useLimitEntry } from './LimitEntry';
import { NAME_MAX, nameHasForbidden, validName } from './validate';

// The limit control moved to LimitEntry so the raise screen uses the very same one (FEAT-61).
export { formatDigits, rangePresets, sliderStep } from './LimitEntry';

export interface RegistrationDraft {
  name: string;
  ceilingCents: number;
}

export interface RegisterScreenProps {
  /** Room minimum and maximum cap (room.config.maxCeilingCents), in cents. */
  minCents: number;
  maxCents: number;
  /** False when the room takes only its presets: the Custom option and its range hint are left out. */
  allowCustom?: boolean;
  /** What the bidder entered before going back from the approval step; shown again as typed. */
  initial?: RegistrationDraft;
  onApprove: (draft: RegistrationDraft) => void;
}

/** Registration steps 1 and 2 (R-WEB-040..042, R-WEB-116). */
export function RegisterScreen({
  minCents,
  maxCents,
  allowCustom = true,
  initial,
  onApprove,
}: RegisterScreenProps) {
  const [step, setStep] = useState<1 | 2>(initial === undefined ? 1 : 2);
  const [name, setName] = useState(initial?.name ?? '');
  const [touched, setTouched] = useState(false);
  const limit = useLimitEntry({
    minCents,
    maxCents,
    allowCustom,
    initialCents: initial?.ceilingCents,
  });
  const { ceilingCents } = limit;

  const nameOk = validName(name);
  const stepOneValid = nameOk;

  const nameProblem = nameHasForbidden(name)
    ? t('reg.nameInvalid')
    : name.trim().length > NAME_MAX
      ? t('reg.nameTooLong', { max: String(NAME_MAX) })
      : t('reg.nameRequired');
  const nameError = touched && !nameOk ? nameProblem : undefined;

  const submitStepOne = (e: FormEvent): void => {
    e.preventDefault();
    setTouched(true);
    if (stepOneValid) {
      setStep(2);
      return;
    }
    announce('assertive', nameProblem);
  };

  /** Checks the ceiling; the amount is sent only after the hold (or its two-tap alternative). */
  const confirmStepTwo = (): void => {
    limit.touch();
    if (ceilingCents === null) {
      if (!allowCustom) return;
      announce('assertive', limit.error ?? limit.rangeText);
      return;
    }
    onApprove({ name: name.trim(), ceilingCents });
  };

  const submitStepTwo = (e: FormEvent): void => {
    e.preventDefault();
    limit.touch();
  };

  if (step === 1) {
    return (
      <main className="gv-flow" data-step="name">
        <h1 tabIndex={-1}>{t('reg.step1')}</h1>
        <form onSubmit={submitStepOne} noValidate>
          <Field
            label={t('reg.name')}
            hint={t('reg.nameHint')}
            value={name}
            maxLength={NAME_MAX}
            autoComplete="nickname"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
            {...(nameError === undefined ? {} : { error: nameError })}
          />
          <Button type="submit" size="bid" disabled={!stepOneValid}>
            {t('reg.continue')}
          </Button>
          {!stepOneValid && (
            <p className="gv-flow__reason" data-testid="continue-reason">
              {t('reg.continueReason')}
            </p>
          )}
        </form>
        <WideAside />
      </main>
    );
  }

  return (
    <main className="gv-flow" data-step="ceiling">
      <h1 tabIndex={-1}>{t('reg.step2')}</h1>
      <p className="gv-flow__summary">{t('reg.summary', { name: name.trim() })}</p>
      <form onSubmit={submitStepTwo} noValidate>
        {limit.fields}
        <section className="gv-flow__held" data-testid="held-block">
          <p>
            <Icon name="lock" />
            <strong>{t('reg.heldNotCharged')}</strong>
          </p>
          <p>
            {ceilingCents !== null
              ? t('reg.heldExplain', { amount: formatUsdCompact(ceilingCents) })
              : t('reg.heldExplainRange', {
                  min: formatUsdCompact(minCents),
                  max: formatUsdCompact(maxCents),
                })}
          </p>
          <p>{t('reg.holdIsNotPayment')}</p>
        </section>
        <FakePaymentsLabel />
        <HoldButton
          key={ceilingCents ?? 'none'}
          label={t('reg.approve')}
          disabled={ceilingCents === null}
          {...(ceilingCents === null ? { disabledReason: t('reg.chooseFirst') } : {})}
          onConfirm={confirmStepTwo}
        />
      </form>
      <WideAside />
    </main>
  );
}
