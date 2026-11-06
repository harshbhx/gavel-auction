import { useState, type FormEvent } from 'react';

import { announce } from '../../a11y/announce';
import { t } from '../../copy/t';
import { FakePaymentsLabel } from '../../design/FakePaymentsLabel';
import { Icon } from '../../design/icons';
import { Button } from '../../design/primitives/Button';
import { Field } from '../../design/primitives/Field';
import { formatUsdCompact } from '../../util/money';
import { customCeilingCents, nameHasForbidden, validName } from './validate';

export interface RegistrationDraft {
  name: string;
  ceilingCents: number;
}

export interface RegisterScreenProps {
  /** Room minimum and maximum cap (room.config.maxCeilingCents), in cents. */
  minCents: number;
  maxCents: number;
  presetsCents?: readonly number[];
  /** False when the room takes only its presets: the Custom option and its range hint are left out. */
  allowCustom?: boolean;
  /** What the bidder entered before going back from the approval step; shown again as typed. */
  initial?: RegistrationDraft;
  onApprove: (draft: RegistrationDraft) => void;
}

const DEFAULT_PRESETS: readonly number[] = [10000, 25000, 50000, 100000];
const CUSTOM = 'custom';

/** Registration steps 1 and 2 (R-WEB-040..042, R-WEB-116). */
export function RegisterScreen({
  minCents,
  maxCents,
  presetsCents = DEFAULT_PRESETS,
  allowCustom = true,
  initial,
  onApprove,
}: RegisterScreenProps) {
  const initialPreset = initial !== undefined && presetsCents.includes(initial.ceilingCents);
  const initialChoice =
    initial === undefined
      ? null
      : initialPreset
        ? String(initial.ceilingCents)
        : allowCustom
          ? CUSTOM
          : null;
  const [step, setStep] = useState<1 | 2>(initial === undefined ? 1 : 2);
  const [name, setName] = useState(initial?.name ?? '');
  const [touched, setTouched] = useState(false);
  const [choice, setChoice] = useState<string | null>(initialChoice);
  const [customText, setCustomText] = useState(
    initial === undefined || initialPreset ? '' : String(initial.ceilingCents / 100),
  );
  const [customTouched, setCustomTouched] = useState(false);

  const nameOk = validName(name);
  const stepOneValid = nameOk;

  const nameError =
    touched && !nameOk
      ? t(nameHasForbidden(name) ? 'reg.nameInvalid' : 'generic.error')
      : undefined;

  const customCents = customCeilingCents(customText, minCents, maxCents);
  let ceilingCents: number | null = null;
  if (choice === CUSTOM) ceilingCents = customCents;
  else if (choice !== null) ceilingCents = Number(choice);
  const customError =
    choice === CUSTOM && customTouched && customCents === null
      ? t('reg.customRange', { min: formatUsdCompact(minCents), max: formatUsdCompact(maxCents) })
      : undefined;

  const submitStepOne = (e: FormEvent): void => {
    e.preventDefault();
    setTouched(true);
    if (stepOneValid) {
      setStep(2);
      return;
    }
    announce('assertive', t(nameHasForbidden(name) ? 'reg.nameInvalid' : 'generic.error'));
  };

  const submitStepTwo = (e: FormEvent): void => {
    e.preventDefault();
    setCustomTouched(true);
    if (ceilingCents === null) {
      if (!allowCustom) return;
      announce(
        'assertive',
        customError ??
          t('reg.customRange', {
            min: formatUsdCompact(minCents),
            max: formatUsdCompact(maxCents),
          }),
      );
      return;
    }
    onApprove({ name: name.trim(), ceilingCents });
  };

  if (step === 1) {
    return (
      <main>
        <h1 tabIndex={-1}>{t('reg.step1')}</h1>
        <form onSubmit={submitStepOne} noValidate>
          <Field
            label={t('reg.name')}
            hint={t('reg.nameHint')}
            value={name}
            maxLength={64}
            autoComplete="nickname"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
            {...(nameError === undefined ? {} : { error: nameError })}
          />
          <Button type="submit" size="bid" disabled={!stepOneValid}>
            {t('reg.continue')}
          </Button>
        </form>
      </main>
    );
  }

  return (
    <main>
      <h1 tabIndex={-1}>{t('reg.step2')}</h1>
      <p>{t('reg.summary', { name: name.trim() })}</p>
      <form onSubmit={submitStepTwo} noValidate>
        <div role="radiogroup" aria-label={t('reg.step2')}>
          {presetsCents.map((cents) => (
            <label key={cents}>
              <input
                type="radio"
                name="ceiling"
                checked={choice === String(cents)}
                onChange={() => setChoice(String(cents))}
              />
              <span>{formatUsdCompact(cents)}</span>
            </label>
          ))}
          {allowCustom && (
            <label>
              <input
                type="radio"
                name="ceiling"
                checked={choice === CUSTOM}
                onChange={() => setChoice(CUSTOM)}
              />
              <span>{t('reg.custom')}</span>
            </label>
          )}
        </div>
        {choice === CUSTOM && (
          <Field
            label={t('reg.custom')}
            value={customText}
            inputMode="numeric"
            onChange={(e) => setCustomText(e.target.value)}
            onBlur={() => setCustomTouched(true)}
            {...(customError === undefined ? {} : { error: customError })}
          />
        )}
        {ceilingCents !== null && (
          <section data-testid="held-block">
            <p>
              <Icon name="lock" />
              <strong>{t('reg.heldNotCharged')}</strong>
            </p>
            <p>{t('reg.heldExplain', { amount: formatUsdCompact(ceilingCents) })}</p>
            <p>{t('reg.holdIsNotPayment')}</p>
          </section>
        )}
        <FakePaymentsLabel />
        <Button type="submit" size="bid" disabled={ceilingCents === null}>
          {t('reg.approve')}
        </Button>
      </form>
    </main>
  );
}
